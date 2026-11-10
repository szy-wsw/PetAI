# -*- coding: utf-8 -*-
"""
database.py —— SQLite 数据库管理器
================================================================
职责：
1. 初始化 SQLite 数据库（文件存放在 D:/PetAI_PetEmotionSystem/db/）；
2. 创建全部业务表（共 6 张，严格对齐需求文档）；
3. 提供 CRUD 通用方法与具体业务查询；
4. 线程安全的连接管理（每次操作独立连接）。

表结构（6 张表）：
- user                  用户表
- recognition_record    识别历史记录表
- pet_knowledge         宠物基础信息表
- pet_diet              分龄喂食库表
- pet_disease_medicine  疾病药品库表
- pet_emotion_solution  情绪安抚库表
"""
import sqlite3
import os
import threading
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime

from utils.path_manager import get_path_manager
from db.supabase_adapter import get_supabase_adapter


# 知识库表名与可写字段映射（用于通用 CRUD）
KNOWLEDGE_TABLES: Dict[str, List[str]] = {
    "pet_knowledge":         ["pet_category", "breed", "description"],
    "pet_diet":              ["pet_category", "age_group", "food_type", "daily_frequency", "forbidden_food"],
    "pet_disease_medicine":  ["pet_category", "disease_name", "symptom", "medicine", "remark"],
    "pet_emotion_solution":  ["pet_category", "emotion", "behavior", "solution"],
}

# 知识库表中文标签
KNOWLEDGE_LABELS: Dict[str, str] = {
    "pet_knowledge":         "宠物基础信息",
    "pet_diet":              "分龄喂食库",
    "pet_disease_medicine":  "疾病药品库",
    "pet_emotion_solution":  "情绪安抚库",
}


class Database:
    """
    SQLite 数据库管理器（单例 + 线程锁）
    """

    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if getattr(self, "_initialized", False):
            return
        pm = get_path_manager()
        self._db_path = pm.get_file_path("db", "pet_emotion.db")
        self._sb = get_supabase_adapter()
        self._initialized = True

    @property
    def use_cloud(self) -> bool:
        """当 Supabase 配置正确且连接正常时使用云端"""
        return self._sb.is_ready()

    # ------------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------------
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def get_db_path(self) -> str:
        return self._db_path

    # ------------------------------------------------------------------
    # 初始化（6 张表）
    # ------------------------------------------------------------------
    def init_db(self) -> bool:
        import time as _time
        last_err = None
        for attempt in range(3):
            try:
                with self._lock:
                    with self._connect() as conn:
                        cur = conn.cursor()
                        # 1. 用户表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS user (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                username TEXT UNIQUE NOT NULL,
                                password TEXT NOT NULL,
                                nickname TEXT,
                                avatar TEXT,
                                role TEXT DEFAULT 'user',
                                status INTEGER DEFAULT 1,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                updated_at TEXT DEFAULT (datetime('now','localtime'))
                            )
                        """)
                        # 2. 识别历史记录表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS recognition_record (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                user_id INTEGER,
                                image_path TEXT NOT NULL,
                                pet_category TEXT,
                                breed TEXT,
                                age_group TEXT,
                                gender TEXT,
                                emotion TEXT,
                                confidence REAL,
                                feeding_advice TEXT,
                                disease_advice TEXT,
                                emotion_advice TEXT,
                                synced INTEGER DEFAULT 0,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                FOREIGN KEY (user_id) REFERENCES user(id)
                            )
                        """)
                        # 3. 宠物基础信息表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS pet_knowledge (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                pet_category TEXT NOT NULL,
                                breed TEXT,
                                description TEXT,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                updated_at TEXT DEFAULT (datetime('now','localtime'))
                            )
                        """)
                        # 4. 分龄喂食库表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS pet_diet (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                pet_category TEXT NOT NULL,
                                age_group TEXT,
                                food_type TEXT,
                                daily_frequency TEXT,
                                forbidden_food TEXT,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                updated_at TEXT DEFAULT (datetime('now','localtime'))
                            )
                        """)
                        # 5. 疾病药品库表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS pet_disease_medicine (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                pet_category TEXT NOT NULL,
                                disease_name TEXT,
                                symptom TEXT,
                                medicine TEXT,
                                remark TEXT,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                updated_at TEXT DEFAULT (datetime('now','localtime'))
                            )
                        """)
                        # 6. 情绪安抚库表
                        cur.execute("""
                            CREATE TABLE IF NOT EXISTS pet_emotion_solution (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                pet_category TEXT NOT NULL,
                                emotion TEXT,
                                behavior TEXT,
                                solution TEXT,
                                created_at TEXT DEFAULT (datetime('now','localtime')),
                                updated_at TEXT DEFAULT (datetime('now','localtime'))
                            )
                        """)
                        # 兼容旧库：确保 recognition_record 具备 synced 列（0=未同步, 1=已同步）
                        cur.execute("PRAGMA table_info(recognition_record)")
                        _rr_cols = [row[1] for row in cur.fetchall()]
                        if "synced" not in _rr_cols:
                            cur.execute("ALTER TABLE recognition_record ADD COLUMN synced INTEGER DEFAULT 0")
                            print("[DB] 旧库升级：recognition_record 已新增 synced 列")
                        conn.commit()
                        # 初始化默认管理员
                        cur.execute("SELECT COUNT(*) FROM user")
                        if cur.fetchone()[0] == 0:
                            from utils.crypto import hash_password
                            pwd_hash = hash_password("admin123")
                            cur.execute(
                                "INSERT INTO user(username, password, nickname, role) VALUES(?,?,?,?)",
                                ("admin", pwd_hash, "管理员", "admin"))
                            conn.commit()
                            # 若已配置 Supabase，同步创建管理员账号，确保多主机登录一致
                            if self.use_cloud:
                                try:
                                    cloud_user = self._sb.get_user_by_username("admin")
                                    if not cloud_user:
                                        self._sb.create_user("admin", pwd_hash, "管理员", "admin")
                                except Exception as e:
                                    print(f"[DB] 云端同步管理员失败: {e}")
                        # 初始化默认知识库
                        for tbl in KNOWLEDGE_TABLES:
                            cur.execute(f"SELECT COUNT(*) FROM {tbl}")
                            if cur.fetchone()[0] == 0:
                                self._seed_default_knowledge(cur, tbl)
                                conn.commit()
                # 表结构就绪后启动后台补传/保活线程（幂等，仅启动一次）
                self.start_sync_thread()
                return True
            except Exception as e:
                last_err = e
                print(f"[DB] 初始化失败(尝试{attempt+1}/3): {e}, path={self._db_path}", flush=True)
                _time.sleep(0.5)
        print(f"[DB] 初始化最终失败: {last_err}", flush=True)
        return False

    def _seed_default_knowledge(self, cur, table: str):
        """填充默认知识库示例数据"""
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        if table == "pet_knowledge":
            data = [
                ('狗', '金毛寻回犬', '大型犬，原产英国；性格温顺友善、智商高，适合家庭饲养；需每日充足运动，易患髋关节发育不良与皮肤问题。'),
                ('狗', '拉布拉多寻回犬', '大型犬，原产加拿大；温顺亲人、食欲旺盛，易肥胖，需控制食量并保证运动量。'),
                ('狗', '德国牧羊犬', '大型工作犬，原产德国；忠诚警觉、服从性高；需大量运动与训练，易患髋关节问题。'),
                ('狗', '比熊犬', '小型犬，原产法国；白色卷毛、性格活泼黏人；需定期美容梳理，易有泪痕。'),
                ('狗', '边境牧羊犬', '中型犬，原产英国；智商居犬类前列、精力极旺盛；需高强度运动与益智活动，否则易出现刻板行为。'),
                ('猫', '英国短毛猫', '中大型短毛猫，原产英国；圆脸圆眼、性格安静温和；易肥胖，有肥厚型心肌病(HCM)风险。'),
                ('猫', '美国短毛猫', '中型短毛猫，原产美国；体质强健、性格活泼亲人，适应力强，适合家庭。'),
                ('猫', '暹罗猫', '中型短毛猫，原产泰国；重点色、叫声多、极其黏人；需关注牙科与呼吸道健康。'),
                ('猫', '布偶猫', '大型长毛猫，原产美国；性格极温顺、忍耐力强；需每日梳理被毛，有HCM与多囊肾风险。'),
                ('猫', '中华田园猫（狸花猫）', '中国本土猫；体质强健、适应力与捕猎本能强，花色多样，是最易饲养的猫种之一。'),
                ('兔子', '荷兰侏儒兔', '体型最小的家兔品种之一；性格胆小温顺，须以干草为主食，避免突然惊吓。'),
                ('兔子', '垂耳兔', '耳廓下垂的家兔；性格温顺，耳道通风差易感染，需定期检查耳道。'),
                ('兔子', '安哥拉兔', '长毛兔；被毛浓密需每日梳理，否则易患毛球症。'),
                ('兔子', '新西兰白兔', '中大型家兔；体质健壮，也可作宠物饲养，需充足干草与活动空间。'),
                ('仓鼠', '叙利亚仓鼠（金丝熊）', '体型较大的仓鼠；领地性极强，必须单笼饲养，夜行性。'),
                ('仓鼠', '坎贝尔侏儒仓鼠（三线仓鼠）', '小型仓鼠；活泼好动，易患糖尿病，需严格控制糖分摄入。'),
                ('仓鼠', '罗伯罗夫斯基仓鼠（老公公）', '体型最小、速度极快；胆小敏感，适合观察而不宜频繁上手。'),
                ('仓鼠', '加卡利亚仓鼠（布丁/紫仓）', '小型仓鼠；温和易养，需防止近亲繁殖与肥胖。'),
                ('龙猫', '长尾毛丝鼠（龙猫）', '原产南美安第斯山脉；群居、性格温顺；须保持环境低于25℃并定期沙浴，寿命可达10年以上。'),
                ('鹦鹉', '虎皮鹦鹉', '小型鹦鹉；活泼好动、易饲养，是入门首选；需注意鹦鹉热与嗉囊炎。'),
                ('鹦鹉', '玄凤鹦鹉', '中型鹦鹉；性格温和、羽粉较多，需注意呼吸道健康与营养均衡。'),
                ('鹦鹉', '和尚鹦鹉', '中型鹦鹉；学习能力强、较善学语，叫声较大，需耐心做行为训练。'),
                ('鹦鹉', '牡丹鹦鹉', '小型鹦鹉；活泼好斗，宜成对饲养，注意禽类传染病与人畜共患风险。'),
                ('鹦鹉', '金刚鹦鹉', '大型鹦鹉；寿命极长(可达50年以上)，需超大活动空间与丰富玩具。'),
                ('乌龟', '巴西红耳龟（红耳龟）', '常见水龟；杂食偏肉食，需晒台与UVB照射，注意水质清洁。'),
                ('乌龟', '中华草龟', '中国本土水龟；耐寒、杂食；需提供晒背区并定期补钙。'),
                ('乌龟', '苏卡达陆龟', '大型陆龟；草食为主，需高纤维饮食、UVB照射与高钙补充，防止软甲。'),
                ('金鱼', '草金鱼', '最接近野生鲫鱼的金鱼品系；体质强健、最易饲养，适合新手。'),
                ('金鱼', '龙睛金鱼', '眼球突出、观赏性强；体质较娇弱，对水质与溶氧要求较高。'),
                ('金鱼', '狮子头金鱼', '头部具肉瘤；需注意肉瘤与头部感染，饲养密度不宜过大。'),
                ('蜥蜴', '鬃狮蜥', '沙漠型蜥蜴；杂食偏昆虫，需晒点38~42℃与UVB，性格温顺，适合新手。'),
                ('蜥蜴', '绿鬣蜥', '树栖草食性蜥蜴；需高湿度与强UVB，饲养难度较高。'),
                ('蜥蜴', '豹纹守宫', '地栖夜行蜥蜴；饲养简单、性格温顺，需加热垫提供腹部热量以助消化。'),
                ('通用', '宠物通用养护', '任何宠物均需关注：清洁饮水与均衡饮食、适宜温湿度与活动空间、定期体检与免疫驱虫、环境丰容与情绪陪伴。'),
            ]
            cur.executemany(
                "INSERT INTO pet_knowledge(pet_category, breed, description) VALUES(?,?,?)", data
            )
        elif table == "pet_diet":
            data = [
                ('狗', '幼年', '高蛋白高能量幼犬粮(粗蛋白约22%~25%)，离乳后逐步过渡，可用温水泡软', '每日3~4次，定时定量', '巧克力、洋葱、大蒜、葡萄及葡萄干、木糖醇、夏威夷果、酒精、生面团'),
                ('狗', '青年', '均衡成犬粮，可搭配少量蔬果与训练零食，保证充足饮水', '每日2次', '巧克力、洋葱、大蒜、葡萄、木糖醇、高盐人类餐桌食物'),
                ('狗', '成年', '均衡成犬粮，依据体况评分调整喂量，控制零食热量以防肥胖', '每日1~2次', '巧克力、洋葱、大蒜、葡萄、细碎骨头、高盐高脂食物'),
                ('狗', '老年', '低脂易消化犬粮，补充Omega-3、氨基葡萄糖与软骨素，关注肾脏健康', '每日2次少量', '高脂、高磷、高钠食物、难消化坚硬食物'),
                ('猫', '幼年', '高蛋白高能量幼猫粮(粗蛋白约30%以上)，动物蛋白为主，可用温水或宠物羊奶粉泡软', '每日3~4次', '牛奶及乳制品(乳糖不耐)、洋葱、大蒜、巧克力、葡萄、生鸡蛋'),
                ('猫', '青年', '高动物蛋白日粮，以湿粮或罐头为主以促进饮水，干湿搭配', '每日2次定量', '洋葱、蒜、巧克力、葡萄、过量生鱼、狗粮'),
                ('猫', '成年', '维持高蛋白、适当控制磷含量，注意体重管理与口腔健康', '每日2次', '洋葱、蒜、巧克力、葡萄、高碳水高磷食物'),
                ('猫', '老年', '易消化高蛋白粮，控制磷钠含量，补充Omega-3与关节营养素', '每日2次少量', '高磷、高钠、难消化食物'),
                ('兔子', '幼年', '以苜蓿干草为主食，配合幼兔粮与少量洗净绿叶菜，保证无限量干草与饮水', '干草无限量，粮分2次喂', '突然换粮、高糖蔬果、豆类、生冷多汁食物'),
                ('兔子', '青年', '由苜蓿逐步过渡到提摩西干草，减少高钙粮，增加绿叶菜比例', '干草无限，粮每日1~2次', '高糖高淀粉食物、过多豆类、腐坏蔬菜'),
                ('兔子', '成年', '提摩西干草无限量+定量成兔粮+洗净绿叶菜，控制钙磷摄入', '干草无限，粮每日1~2次', '高钙苜蓿过量、甜食、坚果瓜子、根茎类过量'),
                ('兔子', '老年', '易咀嚼的柔软干草，控钙并保证充足饮水，必要时补充益生菌', '每日定时定量', '过硬食物、高钙食物、高糖水果'),
                ('仓鼠', '幼年', '高蛋白谷物种子混合粮，搭配少量蔬菜，保证充足磨牙', '每日1~2次少量', '高糖零食、巧克力、柑橘、生豆、杏仁'),
                ('仓鼠', '青年', '混合种子或颗粒粮搭配少量蔬果，可自由储食', '每日1次', '高糖、巧克力、柑橘类、洋葱'),
                ('仓鼠', '成年', '维持混合粮，控制体重与糖分，适量补充动物蛋白', '每日1次', '高糖高脂、巧克力、柑橘类'),
                ('仓鼠', '老年', '易嚼软食，控糖控脂，注意磨牙与补水', '每日1次少量', '高糖高脂食物、坚硬食物'),
                ('龙猫', '幼年', '提摩西干草为主+幼年粮，避免高糖高脂', '干草无限，粮分次', '高糖高脂、过多新鲜蔬果、坚果'),
                ('龙猫', '青年', '干草无限+定量颗粒粮，逐步增加磨牙木', '干草无限，粮每日1次', '葡萄干过量、带生水蔬菜、高脂种子'),
                ('龙猫', '成年', '无限干草+定量颗粒粮，保证磨牙，控制零食', '干草无限，粮每日1次', '葡萄干过量、带生水蔬菜、高糖零食'),
                ('龙猫', '老年', '高纤维易消化食物，补充益生菌，注意牙齿磨损', '每日定时少量', '高脂食物、高糖零食'),
                ('鹦鹉', '幼年', '专用奶粉或配方饲料(幼鸟奶粉)，少量多次，注意保温', '少量多次(每日4~5次)', '人类加工食品、牛油果、巧克力、咖啡因、高盐食物'),
                ('鹦鹉', '青年', '谷物+蔬菜+水果+少量豆类蛋白，逐步完成断奶过渡', '每日2~3次', '单一喂种子、牛油果、巧克力、咖啡因、含盐零食'),
                ('鹦鹉', '成年', '谷物+蔬菜+水果+少量蛋白，补充墨鱼骨补钙', '每日2~3次', '牛油果、巧克力、咖啡因、高脂种子过量'),
                ('鹦鹉', '老年', '易消化食物并补钙，适当补充维生素A', '每日定时', '高脂种子过量、难消化食物'),
                ('乌龟', '幼年', '高蛋白动物性饵料(鱼虾虫)+钙粉，少量多次', '每日1次', '盐、火腿、加工食品、高磷食物'),
                ('乌龟', '青年', '荤素搭配，动物蛋白比重略高，补钙并补充维生素', '每1~2日1次', '高盐、单一饲料、变质饵料'),
                ('乌龟', '成年', '荤素搭配，按种类调整配比(水龟偏肉食、陆龟偏草食)', '每1~2日1次', '高盐、单一饲料、高磷食物'),
                ('乌龟', '老年', '易消化食物，补充钙与维生素，控制投喂量', '每2日1次', '过量投喂、高脂食物'),
                ('金鱼', '幼年', '洄水、丰年虾或微颗粒饲料，少量多次', '每日3~4次少量', '过量、油腻食物、劣质饲料'),
                ('金鱼', '青年', '金鱼专用颗粒或薄片+少量活饵，定量定时', '每日1~2次定量', '过量、人类食物、含油饵料'),
                ('金鱼', '成年', '金鱼专用颗粒为主，可搭配活饵，控制投喂量防过饱', '每日1~2次定量', '过量、人类食物、含油饵料'),
                ('金鱼', '老年', '易消化软饵，减少投喂频次', '每日1次少量', '过量投喂、难消化硬饵'),
                ('蜥蜴', '幼年', '高蛋白昆虫或肉类+钙粉(按UVB情况含或不含D3)，少量多次', '每日1~2次', '单一食物、不补钙、高磷食物'),
                ('蜥蜴', '青年', '按种类调整(鬃狮蜥杂食偏虫、绿鬣蜥以植物为主)，注意补钙', '每日或隔日', '草食性种喂动物蛋白、高磷食物'),
                ('蜥蜴', '成年', '按种类调整食谱，注意钙磷比与维生素补充', '每日或隔日', '草食性种喂动物蛋白、高磷食物'),
                ('蜥蜴', '老年', '易消化食物，控制脂肪与总量', '每周2~3次', '过量投喂、高脂食物'),
            ]
            cur.executemany(
                "INSERT INTO pet_diet(pet_category, age_group, food_type, daily_frequency, forbidden_food) VALUES(?,?,?,?,?)", data
            )
        elif table == "pet_disease_medicine":
            data = [
                ('狗', '犬细小病毒病', '剧烈呕吐、血便(西红柿样)、脱水、精神沉郁、白细胞减少', '补液纠正电解质紊乱+抗病毒(犬细小单克隆抗体/高免血清)+抗生素防继发感染', '需就医，幼犬致死率高；非人畜共患；按时接种含细小的疫苗可预防'),
                ('狗', '犬瘟热', '双相发热、眼鼻脓性分泌物、咳嗽腹泻，后期抽搐、转圈等神经症状', '支持疗法+补液+对症(止吐止泻、控制神经症状)+抗血清', '需就医，致死率高；非人畜共患；接种疫苗可预防'),
                ('狗', '犬传染性肝炎(腺病毒1型)', '发热、精神沉郁、腹痛、呕吐，部分出现角膜水肿(蓝眼)', '支持疗法+补液+保肝+对症', '需就医；非人畜共患；接种含腺病毒的疫苗可预防'),
                ('狗', '犬窝咳(传染性气管支气管炎)', '阵发性干咳、运动或兴奋后加重、偶咳白色泡沫痰', '休息、保暖与止咳，继发细菌感染时用抗生素', '轻症可自愈，重症需就医；非人畜共患；疫区可用疫苗'),
                ('狗', '狂犬病', '行为异常、恐水、流涎、吞咽困难，后期麻痹衰竭死亡', '无有效治疗方法；暴露后立即冲洗伤口并接种疫苗与免疫球蛋白', '需就医；100%人畜共患，属法定报告传染病，必须接种疫苗'),
                ('狗', '犬钩端螺旋体病', '发热、黄疸、尿色深或血尿、呕吐、肌肉酸痛', '青霉素类抗生素+补液保肝肾+支持疗法', '需就医；人畜共患，接触被污染水源或尿液可传人；可接种疫苗预防'),
                ('猫', '猫泛白细胞减少症(猫瘟)', '高热、频繁呕吐、腹泻、脱水、白细胞骤降、精神沉郁', '补液+抗病毒(高免血清)+抗生素防继发感染+对症', '需就医，高致死率；非人畜共患；接种疫苗可预防'),
                ('猫', '猫鼻支(猫疱疹病毒1型/杯状病毒感染)', '打喷嚏、流鼻涕、结膜红肿、眼脓性分泌物、食欲下降、口腔溃疡', '抗病毒(如干扰素，赖氨酸辅助)+对症滴眼鼻+抗生素防继发感染', '需就医；非人畜共患；接种疫苗可减轻症状'),
                ('猫', '猫下泌尿道疾病(FLUTD)/尿道阻塞', '频繁进出猫砂盆、排尿困难、血尿、惨叫，严重时尿闭', '增加饮水与湿粮、减少应激；尿闭需就医导尿与解痉', '完全尿闭属急诊，短时间可致命；非人畜共患'),
                ('猫', '猫癣(皮肤真菌感染)', '圆形脱毛、皮屑、断毛、边缘皮肤发红', '外用或口服抗真菌药+环境消毒+补充营养', '轻度人畜共患，儿童与免疫低下者尤需注意'),
                ('猫', '猫传染性腹膜炎(FIP)', '持续发热、消瘦、腹水或胸水、黄疸，部分出现神经或眼部症状', '以支持疗法为主，必要时使用抗病毒药(须遵兽医处方)', '需就医，病死率高；非人畜共患'),
                ('猫', '猫口炎/齿龈炎', '口臭、流涎、进食咀嚼疼痛、牙龈红肿出血、拒食', '口腔清洁+必要时拔除病变牙+抗炎止痛+抗生素', '需就医；非人畜共患；长期可继发全身问题'),
                ('兔子', '兔球虫病', '腹泻或便秘、消瘦、被毛粗乱、腹部胀大、生长迟缓，重者死亡', '抗球虫药(如磺胺类/妥曲珠利，遵兽医处方)+笼舍清洁消毒', '需就医；非人畜共患；定期消毒与分群饲养可预防'),
                ('兔子', '兔巴氏杆菌病(出血性败血症/鼻炎)', '喷嚏、脓性鼻分泌物、结膜炎、中耳炎歪头、呼吸急促', '抗生素+隔离+改善通风与饲养密度', '需就医；非人畜共患；注意应激与拥挤诱发'),
                ('兔子', '兔胃肠道郁积/毛球症(GI stasis)', '拒食、排便减少或停止、腹部胀、磨牙(疼痛)、精神沉郁', '就医促进胃肠蠕动+补液+止痛+增加运动与饮水', '需紧急就医，可致命；非人畜共患；充足干草与运动可预防'),
                ('兔子', '兔螨病(耳螨/疥螨)', '耳廓结痂、耳内分泌物、剧烈瘙痒、脱毛、摇头', '杀螨药(如伊维菌素/塞拉菌素，遵兽医处方)+环境消毒', '需就医；与人接触可致短暂瘙痒性皮炎'),
                ('兔子', '仔兔轮状病毒病', '水样或糊状腹泻、脱水、消瘦、高致死率', '对症补液+防疫消毒+保温', '需就医；非人畜共患；幼兔最易感'),
                ('兔子', '兔牙齿过长/咬合不正', '流涎、拒食、体重下降、眼鼻分泌物、进食困难', '就医修牙(磨牙)+保证充足干草磨牙+定期检查', '需就医；非人畜共患；干草为主要磨牙手段'),
                ('仓鼠', '湿尾症(增生性回肠炎)', '水样或恶臭腹泻、嗜睡、弓背、尾周潮湿、脱水', '立即就医，抗生素+补液+保温', '需紧急就医，病程快、致死率高；非人畜共患'),
                ('仓鼠', '颊囊感染/脓肿', '颊囊肿胀、流脓、脱出、拒食', '就医清创或排脓+抗生素', '需就医；非人畜共患；勿喂尖锐或黏性食物可预防'),
                ('仓鼠', '呼吸道感染', '打喷嚏、呼吸杂音、鼻分泌物、精神差', '就医+抗生素+更换低粉尘垫料', '需就医；非人畜共患'),
                ('仓鼠', '糖尿病(尤坎贝尔/加卡利亚品系)', '多饮多尿、体重下降、嗜睡、腹围增大', '控制饮食(低糖)+就医监测', '需就医；非人畜共患；以低糖低脂饮食管理为主'),
                ('仓鼠', '皮肤病(螨虫/真菌)', '局部脱毛、皮肤结痂、瘙痒、频繁抓挠', '抗寄生虫或抗真菌治疗+环境消毒+更换垫料', '需就医；部分真菌可人畜共患，注意卫生'),
                ('仓鼠', '肿瘤(老年仓鼠常见)', '体表或腹部出现肿块、消瘦、活动减少', '就医评估，视情况手术或对症护理', '需就医；非人畜共患；老年仓鼠高发'),
                ('龙猫', '牙齿过长/咬合不正', '流涎、拒食、体重下降、眼鼻分泌物、磨牙声', '就医修牙+保证充足干草磨牙+定期口腔检查', '需就医；非人畜共患；充足纤维性干草可预防'),
                ('龙猫', '热应激/中暑', '呼吸急促、张口呼吸、耳朵发红、瘫软、抽搐', '立即降温(移至阴凉或空调环境)+就医', '需紧急就医；环境应长期保持25℃以下；非人畜共患'),
                ('龙猫', '毛球症/肠道阻塞', '拒食、排便减少或停止、腹部胀、精神沉郁', '就医促进胃肠蠕动+补液+增加运动', '需就医；非人畜共患；定期沙浴与充足干草可预防'),
                ('龙猫', '呼吸道感染', '打喷嚏、眼鼻分泌物、呼吸急促、精神差', '就医+抗生素+改善通风与温湿度', '需就医；非人畜共患'),
                ('龙猫', '皮肤病(真菌/螨虫/咬毛)', '局部脱毛、皮肤结痂、被毛稀疏、频繁抓挠', '抗真菌或抗寄生虫治疗+环境消毒+减少应激', '需就医；部分真菌可人畜共患'),
                ('龙猫', '腹泻/肠炎', '软便或水样腹泻、食欲下降、精神沉郁、臀部污毛', '就医+调整饮食(高纤维、勿频繁换粮)+补液', '需就医；非人畜共患；暴饮暴食或高糖食物易诱发'),
                ('鹦鹉', '鹦鹉热(鹦鹉衣原体病)', '精神沉郁、呼吸急促或杂音、腹泻(绿色污便)、鼻眼分泌物、消瘦', '四环素类抗生素(遵兽医处方)+隔离消毒', '需就医；人畜共患，可传人，须重点防护并做好清洁消毒'),
                ('鹦鹉', '禽喙羽病(PBFD)', '羽毛异常脱落或变形、喙过度生长变形、免疫抑制、消瘦', '无特效疗法，隔离+支持疗法+营养支持', '需就医；非人畜共患；多由鹦鹉喙羽病毒引起，病死率高'),
                ('鹦鹉', '嗉囊炎(嗉囊积食/念珠菌感染)', '嗉囊肿胀、反流、食欲下降、嗉囊有酸腐味', '就医冲洗嗉囊+抗真菌或抗菌治疗+调整饮食', '需就医；非人畜共患；注意饲料与饮水卫生'),
                ('鹦鹉', '消化道感染/肠炎', '腹泻、排绿便或水便、食欲下降、消瘦', '就医+对症+调整饮食+补充电解质', '需就医；非人畜共患'),
                ('鹦鹉', '呼吸道感染', '呼吸杂音、张口呼吸、流鼻涕、打喷嚏、尾上下摆动', '就医+抗生素(遵兽医处方)+保温保湿', '需就医；非人畜共患'),
                ('鹦鹉', '羽螨/皮肤寄生虫', '羽毛稀疏、频繁啄羽抓挠、皮肤损伤', '抗寄生虫药+环境与笼具消毒', '需就医；非人畜共患；注意宠物间传染'),
                ('乌龟', '腐甲病', '甲壳发黑、软化、腐烂、有异味、局部凹陷', '清创去除坏死组织+干养+碘伏消毒+抗生素(遵兽医处方)', '需就医；非人畜共患；保持水质清洁与晒背可预防'),
                ('乌龟', '腐皮病', '皮肤(四肢/颈部)发白溃烂、脱皮、有异味', '清创消毒+干养+抗生素', '需就医；非人畜共患；多因水质差与外伤引起'),
                ('乌龟', '白眼病/维生素A缺乏', '眼睑肿胀、睁不开眼、眼部分泌物、拒食', '补充维生素A+抗生素眼药+改善光照与营养', '需就医；非人畜共患；缺乏维生素A与水质差易诱发'),
                ('乌龟', '软甲病/代谢性骨病(MBD)', '甲壳变软变形、四肢无力、生长缓慢、抽搐', '补钙+UVB照射+均衡含钙饮食+遵兽医处方', '需就医；非人畜共患；充足UVB与合理钙磷比是关键'),
                ('乌龟', '肺炎', '张口呼吸、鼻冒泡、侧浮(身体倾斜)、拒食、精神差', '就医+抗生素+加温(维持适宜水温)', '需就医；非人畜共患；温差过大易诱发'),
                ('乌龟', '肠胃炎', '食欲下降、腹泻、粪便异常、精神沉郁、拒食', '就医+抗菌或对症+调整饮食与水质', '需就医；非人畜共患；变质饵料与水质污染易诱发'),
                ('金鱼', '白点病(小瓜虫病)', '体表与鳍布满白色小点、蹭缸、精神萎靡、聚集', '逐步升温至28~30℃并保持+盐浴+抗寄生虫药', '需及时处理；非人畜共患；温差骤变易诱发'),
                ('金鱼', '水霉病(肤霉病)', '体表出现棉絮状白毛、溃烂、继发感染', '抗真菌药+改善水质+隔离', '需处理；非人畜共患；多因外伤与水质差继发'),
                ('金鱼', '烂鳃病', '鳃丝发白、腐烂或附着黏液、浮头、呼吸困难、离群', '消毒+抗生素药浴+换水改善水质', '需处理；非人畜共患'),
                ('金鱼', '肠炎', '肛门红肿、拖便(白便或黏液便)、拒食、腹部胀', '停食+改善饲料+抗菌药物药浴或拌饵', '需处理；非人畜共患；投喂过量或饵料变质易诱发'),
                ('金鱼', '赤皮病', '体表充血发红、鳞片脱落、鳍基发红', '消毒+抗菌药浴+改善水质', '需处理；非人畜共患'),
                ('金鱼', '竖鳞病(立鳞病)', '鳞片竖起呈松球状、腹部膨大、体表粗糙', '抗菌药浴+改善水质+隔离', '需处理；非人畜共患；常继发于细菌感染与水质恶化'),
                ('蜥蜴', '代谢性骨病(MBD)', '四肢抽搐或瘫软、颌骨软化、驼背、拒食、骨骼畸形', '补钙(含D3)+UVB照射+调整钙磷比+兽医评估', '需就医；非人畜共患；缺钙与缺UVB是主因'),
                ('蜥蜴', '口腔炎/口腔腐坏', '口腔红肿溃烂、流涎、拒食、口臭', '局部清洁消毒+抗生素+就医', '需就医；非人畜共患；环境不洁与外伤易诱发'),
                ('蜥蜴', '呼吸道感染', '张口呼吸、喘息、鼻分泌物、精神沉郁', '就医+抗生素+调节温湿度', '需就医；非人畜共患；温湿度不当易诱发'),
                ('蜥蜴', '皮肤感染/脓肿', '皮肤溃烂、局部肿胀、脓肿、脱皮异常', '消毒+抗生素+就医', '需就医；非人畜共患'),
                ('蜥蜴', '蜕皮不畅(残留皮)', '眼周、趾端或尾尖残留旧皮、影响血液循环甚至坏死', '增加湿度+温水泡浴软化+轻柔辅助', '可自行处理，严重需就医；非人畜共患'),
                ('蜥蜴', '肠胃炎/寄生虫', '腹泻、拒食、消瘦、粪便异常、精神差', '就医+驱虫或抗菌+调整饮食与温度', '需就医；非人畜共患；注意饲料与饲养环境卫生'),
            ]
            cur.executemany(
                "INSERT INTO pet_disease_medicine(pet_category, disease_name, symptom, medicine, remark) VALUES(?,?,?,?,?)", data
            )
        elif table == "pet_emotion_solution":
            data = [
                ('狗', '开心', '摇尾巴、蹦跳、主动亲近、耳朵放松', '保持互动与陪伴，适当给予零食或玩具奖励，维持规律运动。'),
                ('狗', '平静', '放松趴卧、缓慢眨眼看主人、身体柔软', '保持环境稳定，可抚摸互动，维持既有作息。'),
                ('狗', '紧张', '夹尾巴、躲藏、颤抖、喘气、身体僵直(常见于雷声、鞭炮)', '提供安全空间与安抚信息素，轻声安抚，避免突然声响，可做脱敏训练。'),
                ('狗', '焦虑', '主人离开后持续吠叫、来回踱步、破坏家具、随地排泄', '离开前充分运动、逐步脱敏训练、环境丰容；严重时咨询行为专科。'),
                ('狗', '生病', '精神萎靡、食欲下降、躲角落、被触碰时躲闪或呜咽', '观察体温与精神状态，尽快就医，注意保暖与补水。'),
                ('狗', '伤心', '低头垂耳、趴卧不动、对呼唤反应淡漠、食欲下降', '增加陪伴与安抚，排查是否因分离、换环境或同伴丢失引起，必要时就医。'),
                ('猫', '开心', '缓慢眨眼、踩奶、呼噜、竖尾靠近', '保持互动与玩耍，提供抓板与攀爬空间，维持稳定环境。'),
                ('猫', '平静', '放松趴卧、耳朵朝前、缓慢摆动尾巴尖', '可适当互动，保持环境稳定与充足资源(水、砂盆分开摆放)。'),
                ('猫', '紧张', '耳朵后压或呈飞机耳、瞳孔放大、炸毛、低声哈气', '提供高处或躲藏点，缓慢接触，勿强行抱抱，减少环境变化。'),
                ('猫', '焦虑', '过度舔毛甚至自舔至秃、躲藏、乱尿、食欲下降', '提供躲藏空间与充足资源，使用费洛蒙扩散器，减少环境变动。'),
                ('猫', '生病', '躲藏不动、拒食拒水、呼吸急促、被毛粗乱、频繁呕吐', '立即就医，注意保暖与补水；幼猫与老年猫应尽快就诊。'),
                ('猫', '伤心', '长时间趴卧、哀叫、寻找同伴、对被抚摸兴趣降低', '排查是否因同伴或主人离开、环境改变，增加陪伴，严重时咨询兽医。'),
                ('兔子', '开心', '侧躺伸展、轻咬跳蹦(binky)、主动靠近', '提供充足活动空间与磨牙物，保持规律喂食与陪伴。'),
                ('兔子', '平静', '安静趴窝、缓慢梳理毛发、耳朵自然放松', '保持安静稳定的环境，提供干草与隐藏空间。'),
                ('兔子', '紧张', '跺脚、僵直不动、耳朵后贴、蜷缩角落', '保持安静低刺激环境，避免突然声响与强行抱抓。'),
                ('兔子', '焦虑', '咬笼、过度啃咬、拔毛、食欲下降', '环境丰容、提供磨牙物与躲藏箱、扩大活动空间。'),
                ('兔子', '生病', '拒食、不排便、弓背磨牙(疼痛)、流涎、呼吸急促', '胃肠郁积可致命，须立即就医，注意保暖与补水。'),
                ('兔子', '伤心', '长时间蜷缩、对食物兴趣降低、躲避接触', '排查应激源与身体不适，增加安静陪伴，必要时就医。'),
                ('仓鼠', '开心', '活跃跑轮、频繁探索、整理毛发、主动取食', '提供跑轮、隧道与藏食玩具，保持垫料清洁与丰容。'),
                ('仓鼠', '平静', '缓慢理毛、囤食、安静休息(多为昼间)', '维持安静环境与规律作息，勿频繁打扰其睡眠。'),
                ('仓鼠', '紧张', '僵住不动、尖叫、翻滚露腹、咬人', '缓慢接近，勿从上方抓取，提供躲藏窝与充足垫料。'),
                ('仓鼠', '焦虑', '咬笼、过度理毛、反复攀爬、拒食', '减少不必要抓取，扩大活动空间，提供丰容玩具。'),
                ('仓鼠', '生病', '弓背、被毛蓬乱、湿尾、呼吸急促、拒食', '立即就医，注意保温与补液；湿尾等属急症。'),
                ('仓鼠', '伤心', '活动明显减少、蜷缩少动、进食减少、对玩具无兴趣', '排查疾病与环境应激，保持温暖安静并就医。'),
                ('龙猫', '开心', '跳跃打滚、主动出笼探索、啃咬磨牙木', '提供跳板与咬木、规律沙浴，保持25℃以下环境。'),
                ('龙猫', '平静', '安静趴卧、缓慢理毛、沙浴后休息', '维持安静环境与规律作息，定期沙浴。'),
                ('龙猫', '紧张', '呆立、喷尿、逃跑、拔毛', '缓慢接近，提供遮光躲藏处，减少噪音与突然动作。'),
                ('龙猫', '焦虑', '咬笼、拔毛、拒食、刻板来回踱步', '环境丰容、扩大活动空间、控制温度并减少应激源。'),
                ('龙猫', '生病', '拒食、不排便、呼吸急促、耳朵发红瘫软', '须紧急就医；注意降温与补水，热应激可致命。'),
                ('龙猫', '伤心', '蜷缩少动、对沙浴与玩具失去兴趣、进食减少', '排查应激与身体不适，保持安静温暖并就医。'),
                ('鹦鹉', '开心', '鸣叫欢快、展翅、主动与主人互动、啃咬玩具', '增加陪伴与玩具，进行正向训练与适度放飞活动。'),
                ('鹦鹉', '平静', '安静理羽、单脚站立休息、低声咕哝', '保持环境稳定，提供规律作息与清洁的饮水食物。'),
                ('鹦鹉', '紧张', '惊飞扑翅、乱撞、竖起羽冠、发出尖叫警报', '安静环境、遮罩低刺激，缓慢适应新环境与陌生人。'),
                ('鹦鹉', '焦虑', '啄羽甚至拔毛至秃、反复摇头、咬笼、拒食', '环境丰容、增加玩具与社交互动，就医排除寄生虫与营养因素。'),
                ('鹦鹉', '生病', '羽毛蓬松缩头、嗜睡、呼吸杂音、尾上下摆动、食欲下降', '立即就医并保温；禽类常掩盖症状，恶化快。'),
                ('鹦鹉', '伤心', '叫声低沉或沉默、少动缩颈、对互动无反应', '排查同伴或主人变化与身体不适，增加安抚与陪伴并就医。'),
                ('乌龟', '开心', '主动浮出水面觅食、频繁游动探索、靠近主人', '保持规律喂食与清洁水质，可适当增加晒台与活动空间。'),
                ('乌龟', '平静', '安静晒背、缓慢游动、缩壳休息', '维持稳定水温、光照与作息。'),
                ('乌龟', '紧张', '缩壳、急促游动躲藏、拒食', '稳定水温与光照，减少外界干扰与突然抓取。'),
                ('乌龟', '焦虑', '反复撞缸、爬缸壁、拒食、呼吸急促', '扩大饲养空间，稳定水质水温，减少惊扰。'),
                ('乌龟', '生病', '拒食、侧浮、张口呼吸、眼睛肿胀、甲壳或皮肤异常', '立即就医并加温，注意水质与营养。'),
                ('乌龟', '伤心', '长时间缩壳不动、对食物兴趣降低、躲避光照', '排查温度、水质与疾病因素，保持安静稳定并就医。'),
                ('金鱼', '开心', '活跃游动、主动索食、鳍展开', '保持水质与规律投喂，提供水草等环境丰容。'),
                ('金鱼', '平静', '缓慢平稳游动、鳍自然舒展、安静悬停', '维持稳定水质与光照，避免强光惊扰。'),
                ('金鱼', '紧张', '急游、躲在角落、浮头、体色变淡', '稳定水质与水温，避免强光与惊扰，规律换水。'),
                ('金鱼', '焦虑', '蹭缸、缩鳍、拒食、游动异常', '检查水质(氨氮/亚硝酸盐)与溶氧，提供躲避物并部分换水。'),
                ('金鱼', '生病', '浮头、离群、体表白点或溃疡、拖便、鳍烂', '立即隔离并检查水质，对症用药(升温/盐浴/药物)。'),
                ('金鱼', '伤心', '长时间沉底不动、躲藏、食欲全无', '检查水温水质与疾病，稳定环境并隔离观察。'),
                ('蜥蜴', '开心', '主动探索、伸舌舔舐、体色明亮、活跃晒点', '保持正确温湿度与光照，提供躲避穴与丰富环境。'),
                ('蜥蜴', '平静', '安静趴卧晒点、缓慢呼吸、体色稳定', '维持温湿度梯度与规律作息。'),
                ('蜥蜴', '紧张', '张嘴威吓、甩尾、体色变暗、僵直', '减少抓取，提供躲避穴与正确温湿度。'),
                ('蜥蜴', '焦虑', '频繁冲撞、拒食、来回踱步、蜕皮异常', '检查温湿度、空间与光照，减少应激源。'),
                ('蜥蜴', '生病', '拒食、张口呼吸、肢体无力抽搐、皮肤溃烂', '立即就医并调整温湿度与钙/UVB，MBD需及时干预。'),
                ('蜥蜴', '伤心', '长时间躲藏不动、体色暗淡、对食物无反应', '排查温湿度、光照与疾病因素，保持安静并就医。'),
            ]
            cur.executemany(
                "INSERT INTO pet_emotion_solution(pet_category, emotion, behavior, solution) VALUES(?,?,?,?)", data
            )

    # ------------------------------------------------------------------
    # 通用 CRUD
    # ------------------------------------------------------------------
    def execute(self, sql: str, params: Tuple = ()) -> int:
        with self._lock:
            with self._connect() as conn:
                cur = conn.cursor()
                cur.execute(sql, params)
                conn.commit()
                return cur.lastrowid

    def query(self, sql: str, params: Tuple = ()) -> List[Dict[str, Any]]:
        with self._lock:
            with self._connect() as conn:
                cur = conn.cursor()
                cur.execute(sql, params)
                return [dict(r) for r in cur.fetchall()]

    def query_one(self, sql: str, params: Tuple = ()) -> Optional[Dict[str, Any]]:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    # ------------------------------------------------------------------
    # 用户相关
    # ------------------------------------------------------------------
    def add_user(self, username: str, password: str, nickname: str = "",
                 role: str = "user") -> Tuple[bool, str]:
        from utils.crypto import hash_password
        pwd_hash = hash_password(password)
        try:
            self.execute(
                "INSERT INTO user(username, password, nickname, role) VALUES(?,?,?,?)",
                (username, pwd_hash, nickname or username, role))
            # 云端同步创建用户
            if self.use_cloud:
                try:
                    self._sb.create_user(username, pwd_hash, nickname, role)
                except Exception as e:
                    print(f"[DB] 云端创建用户失败（已保留本地）: {e}")
            return True, "注册成功"
        except sqlite3.IntegrityError:
            return False, "用户名已存在"
        except Exception as e:
            return False, f"注册失败: {e}"

    def verify_user(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        from utils.crypto import verify_password
        # 云端优先
        if self.use_cloud:
            try:
                user = self._sb.get_user_by_username(username)
                if user and user.get("status") == 1 and verify_password(password, user["password"]):
                    # 同步到本地缓存
                    self._sync_user_to_local(user)
                    return user
            except Exception as e:
                print(f"[DB] 云端验证失败，降级本地: {e}")
        user = self.query_one("SELECT * FROM user WHERE username=? AND status=1", (username,))
        if user and verify_password(password, user["password"]):
            return user
        return None

    def _sync_user_to_local(self, user: Dict):
        """将云端用户同步到本地 SQLite 缓存"""
        try:
            exists = self.query_one("SELECT id FROM user WHERE username=?", (user["username"],))
            if exists:
                self.execute(
                    "UPDATE user SET password=?, nickname=?, role=?, status=?, updated_at=? WHERE id=?",
                    (user.get("password", ""), user.get("nickname", user["username"]),
                     user.get("role", "user"), user.get("status", 1),
                     datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user["id"]))
            else:
                self.execute(
                    "INSERT INTO user(id, username, password, nickname, role, status, created_at, updated_at) VALUES(?,?,?,?,?,?,?,?)",
                    (user["id"], user["username"], user.get("password", ""),
                     user.get("nickname", user["username"]), user.get("role", "user"),
                     user.get("status", 1), user.get("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
                     user.get("updated_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))))
        except Exception as e:
            print(f"[DB] 同步用户到本地失败: {e}")

    def update_user_profile(self, user_id: int, nickname: str = None,
                            avatar: str = None, password: str = None) -> bool:
        sets, params = [], []
        if nickname is not None:
            sets.append("nickname=?")
            params.append(nickname)
        if avatar is not None:
            sets.append("avatar=?")
            params.append(avatar)
        if password:
            from utils.crypto import hash_password
            sets.append("password=?")
            params.append(hash_password(password))
        if not sets:
            return False
        sets.append("updated_at=?")
        params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        params.append(user_id)
        self.execute(f"UPDATE user SET {','.join(sets)} WHERE id=?", tuple(params))
        return True

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        if self.use_cloud:
            try:
                user = self._sb.get_user_by_id(user_id)
                if user:
                    self._sync_user_to_local(user)
                    return user
            except Exception as e:
                print(f"[DB] 云端查询用户失败，降级本地: {e}")
        return self.query_one("SELECT * FROM user WHERE id=?", (user_id,))

    def list_users(self) -> List[Dict[str, Any]]:
        if self.use_cloud:
            try:
                users = self._sb.list_users()
                # 同步到本地缓存
                for u in users:
                    try:
                        self._sync_user_to_local(u)
                    except Exception:
                        pass
                return users
            except Exception as e:
                print(f"[DB] 云端列出用户失败，降级本地: {e}")
        return self.query("SELECT id, username, nickname, avatar, role, status, created_at FROM user ORDER BY id")

    def set_user_status(self, user_id: int, status: int) -> bool:
        # 本地更新
        self.execute("UPDATE user SET status=?, updated_at=? WHERE id=?",
                     (status, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), user_id))
        # 云端同步
        if self.use_cloud:
            try:
                self._sb.update_user_status(user_id, status)
            except Exception as e:
                print(f"[DB] 云端更新用户状态失败: {e}")
        return True

    # ------------------------------------------------------------------
    # 识别记录相关
    # ------------------------------------------------------------------
    def add_record(self, **kwargs) -> int:
        cols = ["user_id", "image_path", "pet_category", "breed", "age_group",
                "gender", "emotion", "confidence", "feeding_advice",
                "disease_advice", "emotion_advice"]
        vals = [kwargs.get(c) for c in cols]

        # 本地优先：先写入本地 SQLite 并标记 synced=0，保证离线也绝不丢数据
        placeholders = ",".join(["?"] * len(cols))
        local_id = self.execute(
            f"INSERT INTO recognition_record({','.join(cols)}, synced) VALUES({placeholders}, 0)",
            tuple(vals))

        # 再尝试写云端：成功则置 synced=1；失败保持 0 且不抛异常（交给后台线程补传）
        if self.use_cloud:
            record = {c: v for c, v in zip(cols, vals)}
            try:
                cloud_id = self._sb.add_record(record)
                if cloud_id is None:
                    raise RuntimeError("Supabase 返回空 id，写入可能失败")
                self.execute("UPDATE recognition_record SET synced=1 WHERE id=?", (local_id,))
                print(f"[DB] 云端同步成功: cloud_id={cloud_id}")
            except Exception as e:
                err = f"云端保存记录失败: {e}"
                print(f"[DB] {err}（已保存在本地，稍后自动补传）")
                self._last_cloud_error = err

        return local_id

    # ------------------------------------------------------------------
    # 云端补传 + 保活（后台线程）
    # ------------------------------------------------------------------
    def is_cloud_reachable(self) -> bool:
        """探测云端是否真正可用（做一次轻量查询，兼作保活）"""
        if not self.use_cloud:
            return False
        try:
            return bool(self._sb.test_connection().get("success", False))
        except Exception:
            return False

    def sync_pending_records(self) -> int:
        """把本地 synced=0 的识别记录逐条补传到云端，成功后置 synced=1。
        单条失败只跳过不中断整批；本方法同时承担保活作用。"""
        if not self.use_cloud:
            return 0
        if not self.is_cloud_reachable():
            return 0
        try:
            rows = self.query("SELECT * FROM recognition_record WHERE synced=0 ORDER BY id")
        except Exception as e:
            print(f"[同步] 查询待同步记录失败: {e}")
            return 0
        if not rows:
            return 0
        print(f"[同步] 检测到云端可用，开始补传 {len(rows)} 条待同步记录")
        cols = ["user_id", "image_path", "pet_category", "breed", "age_group",
                "gender", "emotion", "confidence", "feeding_advice",
                "disease_advice", "emotion_advice", "created_at"]
        done = 0
        for r in rows:
            try:
                record = {c: r.get(c) for c in cols}
                cloud_id = self._sb.add_record(record)
                if cloud_id:
                    self.execute("UPDATE recognition_record SET synced=1 WHERE id=?", (r["id"],))
                    done += 1
                    print(f"[同步] 已补传本地记录 id={r['id']} → cloud_id={cloud_id}")
                else:
                    print(f"[同步] 本地记录 id={r['id']} 补传失败，稍后重试")
            except Exception as e:
                print(f"[同步] 本地记录 id={r['id']} 补传异常，跳过: {e}")
        print(f"[同步] 本轮补传完成，成功 {done}/{len(rows)} 条")
        return done

    def _get_sync_interval(self) -> int:
        """从 local_config.json 读取同步/保活周期（秒），默认 300"""
        try:
            import json
            cfg_path = get_path_manager().get_file_path("db", "local_config.json")
            if os.path.exists(cfg_path):
                with open(cfg_path, "r", encoding="utf-8") as f:
                    val = int(json.load(f).get("sync_interval", 300))
                    return val if val > 0 else 300
        except Exception:
            pass
        return 300

    def start_sync_thread(self, interval: int = None):
        """启动后台补传/保活线程（幂等：已运行则不重复启动）"""
        if getattr(self, "_sync_thread", None) and self._sync_thread.is_alive():
            return
        if interval is None:
            interval = self._get_sync_interval()
        self._sync_stop = threading.Event()

        def _loop():
            while not self._sync_stop.is_set():
                try:
                    # 每轮做一次云端探测（补传 + 保活）
                    self.sync_pending_records()
                except Exception as e:
                    print(f"[同步] 后台同步异常: {e}")
                self._sync_stop.wait(interval)

        self._sync_thread = threading.Thread(target=_loop, name="cloud-sync", daemon=True)
        self._sync_thread.start()
        print(f"[同步] 后台补传/保活线程已启动（每 {interval} 秒检查一次云端）")

    def list_records(self, user_id: int = None, page: int = 1, page_size: int = 10,
                     pet_category: str = None, emotion: str = None,
                     date_from: str = None, date_to: str = None, keyword: str = None) -> Tuple[List[Dict], int]:
        # 云端优先
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=2000) if user_id is None else self._sb.get_records_by_user(user_id, limit=2000)
                # 合并本地未同步记录，避免补传前本地记录在界面上"消失"
                try:
                    if user_id is None:
                        extra = self.query("SELECT * FROM recognition_record WHERE synced=0")
                    else:
                        extra = self.query("SELECT * FROM recognition_record WHERE synced=0 AND user_id=?", (user_id,))
                    if extra:
                        rows = list(rows or []) + list(extra)
                        rows.sort(key=lambda x: str(x.get("created_at", "")), reverse=True)
                except Exception:
                    pass
                if rows:
                    # 内存过滤
                    filtered = []
                    for r in rows:
                        # 统一取日期部分，兼容 "YYYY-MM-DD HH:MM:SS" 与 ISO "YYYY-MM-DDTHH:MM:SS"
                        created_date = str(r.get("created_at", ""))[:10]
                        if pet_category and r.get("pet_category") != pet_category:
                            continue
                        if emotion and r.get("emotion") != emotion:
                            continue
                        if date_from and created_date < date_from:
                            continue
                        if date_to and created_date > date_to:
                            continue
                        if keyword:
                            text = " ".join([str(r.get(k, "")) for k in ["breed", "pet_category", "emotion", "feeding_advice", "disease_advice"]])
                            if keyword.lower() not in text.lower():
                                continue
                        filtered.append(r)
                    total = len(filtered)
                    offset = (page - 1) * page_size
                    return filtered[offset:offset + page_size], total
            except Exception as e:
                print(f"[DB] 云端查询记录失败，降级本地: {e}")

        # 本地降级
        where, params = [], []
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        if pet_category:
            where.append("pet_category=?")
            params.append(pet_category)
        if emotion:
            where.append("emotion=?")
            params.append(emotion)
        if date_from:
            where.append("DATE(created_at) >= ?")
            params.append(date_from)
        if date_to:
            where.append("DATE(created_at) <= ?")
            params.append(date_to)
        if keyword:
            where.append("(breed LIKE ? OR pet_category LIKE ? OR emotion LIKE ? OR feeding_advice LIKE ? OR disease_advice LIKE ?)")
            like = f"%{keyword}%"
            params.extend([like, like, like, like, like])
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        total_result = self.query_one(f"SELECT COUNT(*) AS c FROM recognition_record {where_sql}", tuple(params))
        total = total_result["c"] if total_result else 0
        offset = (page - 1) * page_size
        rows = self.query(
            f"SELECT * FROM recognition_record {where_sql} ORDER BY created_at DESC LIMIT ? OFFSET ?",
            tuple(params) + (page_size, offset))
        return rows, total

    def count_records(self, user_id: int = None) -> int:
        """统计记录总数 - 云端优先"""
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=5000) if user_id is None else self._sb.get_records_by_user(user_id, limit=5000)
                if rows:
                    return len(rows)
            except Exception as e:
                print(f"[DB] 云端统计记录失败，降级本地: {e}")
        # 本地降级
        where, params = [], []
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        result = self.query_one(f"SELECT COUNT(*) AS c FROM recognition_record {where_sql}", tuple(params))
        return result["c"] if result else 0

    def count_by_category(self, user_id: int = None) -> List[Dict]:
        """按类别统计 - 云端优先"""
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=5000) if user_id is None else self._sb.get_records_by_user(user_id, limit=5000)
                if rows:
                    counts = {}
                    for r in rows:
                        cat = r.get("pet_category", "未知")
                        counts[cat] = counts.get(cat, 0) + 1
                    return [{"pet_category": k, "count": v} for k, v in counts.items()]
            except Exception as e:
                print(f"[DB] 云端分类统计失败，降级本地: {e}")
        # 本地降级
        where, params = [], []
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        return self.query(
            f"SELECT pet_category, COUNT(*) AS count FROM recognition_record {where_sql} GROUP BY pet_category",
            tuple(params))

    def count_by_emotion(self, user_id: int = None) -> List[Dict]:
        """按情绪统计 - 云端优先"""
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=5000) if user_id is None else self._sb.get_records_by_user(user_id, limit=5000)
                if rows:
                    counts = {}
                    for r in rows:
                        emo = r.get("emotion", "未知")
                        counts[emo] = counts.get(emo, 0) + 1
                    return [{"emotion": k, "count": v} for k, v in counts.items()]
            except Exception as e:
                print(f"[DB] 云端情绪统计失败，降级本地: {e}")
        # 本地降级
        where, params = [], []
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        return self.query(
            f"SELECT emotion, COUNT(*) AS count FROM recognition_record {where_sql} GROUP BY emotion",
            tuple(params))

    def count_today_records(self, user_id: int = None) -> int:
        """统计今日记录数 - 云端优先"""
        today = datetime.now().strftime("%Y-%m-%d")
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=5000) if user_id is None else self._sb.get_records_by_user(user_id, limit=5000)
                if rows:
                    return sum(1 for r in rows if str(r.get("created_at", "")).startswith(today))
            except Exception as e:
                print(f"[DB] 云端今日统计失败，降级本地: {e}")
        # 本地降级
        where, params = ["DATE(created_at)=?"], [today]
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        where_sql = "WHERE " + " AND ".join(where)
        result = self.query_one(f"SELECT COUNT(*) AS c FROM recognition_record {where_sql}", tuple(params))
        return result["c"] if result else 0

    def count_by_date(self, date_str: str, user_id: int = None) -> int:
        """统计指定日期记录数 - 云端优先"""
        if self.use_cloud:
            try:
                rows = self._sb.get_all_records(limit=5000) if user_id is None else self._sb.get_records_by_user(user_id, limit=5000)
                if rows:
                    return sum(1 for r in rows if str(r.get("created_at", "")).startswith(date_str))
            except Exception as e:
                print(f"[DB] 云端日期统计失败，降级本地: {e}")
        # 本地降级
        where, params = ["DATE(created_at)=?"], [date_str]
        if user_id is not None:
            where.append("user_id=?")
            params.append(user_id)
        where_sql = "WHERE " + " AND ".join(where)
        result = self.query_one(f"SELECT COUNT(*) AS c FROM recognition_record {where_sql}", tuple(params))
        return result["c"] if result else 0

    def delete_record(self, record_id: int) -> bool:
        self.execute("DELETE FROM recognition_record WHERE id=?", (record_id,))
        if self.use_cloud:
            try:
                self._sb.delete_record(record_id)
            except Exception as e:
                print(f"[DB] 云端删除记录失败: {e}")
        return True

    def delete_records_batch(self, ids: List[int]) -> int:
        if not ids:
            return 0
        placeholders = ",".join(["?"] * len(ids))
        with self._lock:
            with self._connect() as conn:
                cur = conn.cursor()
                cur.execute(f"DELETE FROM recognition_record WHERE id IN ({placeholders})", tuple(ids))
                conn.commit()
                if self.use_cloud:
                    for rid in ids:
                        try:
                            self._sb.delete_record(rid)
                        except Exception:
                            pass
                return cur.rowcount

    def clear_all_records(self, user_id: int = None) -> int:
        """清空全部识别记录（管理员可清全部，普通用户仅清自己的）"""
        with self._lock:
            with self._connect() as conn:
                cur = conn.cursor()
                if user_id is not None:
                    cur.execute("DELETE FROM recognition_record WHERE user_id=?", (user_id,))
                else:
                    cur.execute("DELETE FROM recognition_record")
                conn.commit()
                return cur.rowcount

    # ------------------------------------------------------------------
    # 知识库通用 CRUD（4 张表：pet_knowledge / pet_diet / pet_disease_medicine / pet_emotion_solution）
    # ------------------------------------------------------------------
    def add_knowledge(self, table: str, **kwargs) -> int:
        """新增知识条目（按表名自动取可写字段）"""
        fields = KNOWLEDGE_TABLES.get(table, [])
        cols = [f for f in fields if f in kwargs]
        vals = [kwargs[f] for f in cols]
        if not cols:
            return 0
        placeholders = ",".join(["?"] * len(cols))
        return self.execute(
            f"INSERT INTO {table}({','.join(cols)}) VALUES({placeholders})",
            tuple(vals))

    def update_knowledge(self, table: str, kid: int, **kwargs) -> bool:
        fields = KNOWLEDGE_TABLES.get(table, [])
        sets, params = [], []
        for f in fields:
            if f in kwargs:
                sets.append(f"{f}=?")
                params.append(kwargs[f])
        if not sets:
            return False
        sets.append("updated_at=?")
        params.append(datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        params.append(kid)
        self.execute(f"UPDATE {table} SET {','.join(sets)} WHERE id=?", tuple(params))
        return True

    def delete_knowledge(self, table: str, kid: int) -> bool:
        self.execute(f"DELETE FROM {table} WHERE id=?", (kid,))
        return True

    def list_knowledge(self, table: str, pet_category: str = None,
                       keyword: str = None, page: int = 1, page_size: int = 20) -> Tuple[List[Dict], int]:
        where, params = [], []
        if pet_category:
            where.append("(pet_category=? OR pet_category='通用')")
            params.append(pet_category)
        if keyword:
            text_cols = [c for c in KNOWLEDGE_TABLES.get(table, []) if c != "pet_category"]
            if text_cols:
                kw_clause = " OR ".join([f"{c} LIKE ?" for c in text_cols])
                where.append(f"({kw_clause})")
                params += [f"%{keyword}%"] * len(text_cols)
        where_sql = ("WHERE " + " AND ".join(where)) if where else ""
        total_result = self.query_one(f"SELECT COUNT(*) AS c FROM {table} {where_sql}", tuple(params))
        total = total_result["c"] if total_result else 0
        offset = (page - 1) * page_size
        rows = self.query(
            f"SELECT * FROM {table} {where_sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?",
            tuple(params) + (page_size, offset))
        return rows, total

    def get_knowledge_by_pet(self, table: str, pet_category: str) -> List[Dict]:
        """按宠物类别获取知识条目（识别结果联动用）"""
        return self.query(
            f"SELECT * FROM {table} WHERE pet_category=? OR pet_category='通用' ORDER BY id",
            (pet_category,))


# 全局便捷访问
def get_db() -> Database:
    return Database()
