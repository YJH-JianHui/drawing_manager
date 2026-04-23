import sqlite3

def init_db():
    conn = sqlite3.connect('drawing_system.db')
    cursor = conn.cursor()
    # 核心修改：增加 UNIQUE(borrow_order_id, chart_no) 约束
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS drawing_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            borrow_order_id TEXT,      -- 借用单号
            seq_no TEXT,               -- 序号
            work_order_id TEXT,        -- 工作令号
            chart_no TEXT,             -- 图号
            purpose TEXT,              -- 用途
            page_format TEXT,          -- 幅面
            drawing_type TEXT,         -- 类型
            borrower_name TEXT,        -- 借用人
            borrower_id TEXT,          -- 借用人ID
            borrow_time TEXT,          -- 借用时间
            return_time TEXT,          -- 归还时间
            status TEXT DEFAULT '待借出',
            UNIQUE(borrow_order_id, chart_no) -- 借用单号+图号 唯一约束
        )
    ''')
    conn.commit()
    conn.close()

init_db()