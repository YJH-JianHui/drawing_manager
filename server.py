#!/usr/bin/env python
# -*- coding: UTF-8 -*-
import os
import time
import hashlib
import requests
import re  # 修正：必须导入正则库
import pandas as pd
import sqlite3
from auth import Auth
from dotenv import load_dotenv, find_dotenv
from flask import Flask, request, jsonify, render_template

# 从 .env 文件加载环境变量参数
load_dotenv(find_dotenv())

app = Flask(__name__, static_url_path="/public", static_folder="./public")

# const
NONCE_STR = "13oEviLbrTo458A3NjrOwS70oTOXVOAm"
APP_ID = os.getenv("APP_ID")
APP_SECRET = os.getenv("APP_SECRET")
FEISHU_HOST = os.getenv("FEISHU_HOST")


# 初始化数据库
def init_db():
    conn = sqlite3.connect('drawing_system.db')
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS drawing_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            borrow_order_id TEXT,
            seq_no TEXT,
            work_order_id TEXT,
            chart_no TEXT,
            purpose TEXT,
            page_format TEXT,
            drawing_type TEXT,
            borrower_name TEXT,
            borrower_id TEXT,
            borrow_time TEXT,
            return_time TEXT,
            status TEXT DEFAULT '待借出'
        )
    ''')
    conn.commit()
    conn.close()


init_db()  # 启动时初始化数据库

auth = Auth(FEISHU_HOST, APP_ID, APP_SECRET)


@app.errorhandler(Exception)
def auth_error_handler(ex):
    # 打印具体的错误日志到控制台，方便调试
    print(f"Error: {ex}")
    response = jsonify(message=str(ex))
    response.status_code = 500
    return response


@app.route("/", methods=["GET"])
def get_home():
    return render_template("index.html")


@app.route("/get_config_parameters", methods=["GET"])
def get_config_parameters():
    url = request.args.get("url")
    ticket = auth.get_ticket()
    timestamp = int(time.time()) * 1000
    verify_str = "jsapi_ticket={}&noncestr={}&timestamp={}&url={}".format(
        ticket, NONCE_STR, timestamp, url
    )
    signature = hashlib.sha1(verify_str.encode("utf-8")).hexdigest()
    return jsonify({
        "appid": APP_ID,
        "signature": signature,
        "noncestr": NONCE_STR,
        "timestamp": timestamp,
    })


@app.route("/checkout", methods=["GET"])
def get_checkout_page():
    return render_template("checkout.html")


@app.route("/query", methods=["GET"])
def get_query_page():
    return render_template("query.html")


@app.route("/import", methods=["GET"])
def import_page():
    return render_template("import.html")


# 修正后的上传接口
@app.route("/api/upload_excel", methods=["POST"])
def upload_excel():
    if 'file' not in request.files:
        return jsonify({"code": -1, "msg": "未找到文件"})

    file = request.files['file']
    display_filename = request.form.get('filename') or file.filename

    match = re.search(r'(Y[A-Z0-9_]+)', display_filename)
    if not match:
        return jsonify({"code": -1, "msg": "文件名不包含单号"})

    borrow_order_id = match.group(1)

    try:
        df = pd.read_excel(file)
        df = df.fillna("")

        conn = sqlite3.connect('drawing_system.db')
        cursor = conn.cursor()

        # 【核心逻辑】：先删除该单号下已存在的所有记录
        # 这样无论你导入多少次，数据库里永远只有最新的一份，不会重复
        cursor.execute('DELETE FROM drawing_records WHERE borrow_order_id = ?', (borrow_order_id,))
        print(f"已清理单号 {borrow_order_id} 的旧记录")

        count = 0
        for _, row in df.iterrows():
            # 这里的字段要和你 Excel 表头完全对应
            cursor.execute('''
                INSERT INTO drawing_records 
                (borrow_order_id, seq_no, work_order_id, chart_no, purpose, page_format, drawing_type)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (
                borrow_order_id,
                str(row.get('序号', '')),
                str(row.get('工作令号', '')),
                str(row.get('图号', '')),
                str(row.get('用途', '')),
                str(row.get('幅面', '')),
                str(row.get('类型', ''))
            ))
            count += 1

        conn.commit()
        conn.close()
        return jsonify({"code": 0, "msg": f"单号 {borrow_order_id} 导入成功，共 {count} 条记录"})

    except Exception as e:
        print(f"解析出错: {e}")
        return jsonify({"code": -1, "msg": f"解析失败: {str(e)}"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True, use_reloader=False)