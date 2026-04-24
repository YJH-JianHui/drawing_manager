#!/usr/bin/env python
# -*- coding: UTF-8 -*-
import os
import time
import hashlib
import re
import pandas as pd
import sqlite3
import requests
from auth import Auth
from dotenv import load_dotenv, find_dotenv
from flask import Flask, request, jsonify, render_template

load_dotenv(find_dotenv())

app = Flask(__name__, static_url_path="/public", static_folder="./public")

NONCE_STR   = "13oEviLbrTo458A3NjrOwS70oTOXVOAm"
APP_ID      = os.getenv("APP_ID")
APP_SECRET  = os.getenv("APP_SECRET")
FEISHU_HOST = os.getenv("FEISHU_HOST")

STATUS_PENDING  = '待借出'
STATUS_DRAFT    = '草稿'
STATUS_OUT      = '已借出'
STATUS_RETURNED = '已归还'
STATUS_NODRAW   = '无图'


def get_conn():
    conn = sqlite3.connect('drawing_system.db')
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute('''
        CREATE TABLE IF NOT EXISTS drawing_records (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            borrow_order_id      TEXT,
            seq_no               TEXT,
            work_order_id        TEXT,
            chart_no             TEXT,
            purpose              TEXT,
            page_format          TEXT,
            drawing_type         TEXT,
            lend_manager_name    TEXT,
            lend_manager_id      TEXT,
            borrower_name        TEXT,
            borrower_id          TEXT,
            borrow_time          TEXT,
            return_manager_name  TEXT,
            return_manager_id    TEXT,
            returner_name        TEXT,
            returner_id          TEXT,
            return_time          TEXT,
            status               TEXT DEFAULT '待借出'
        )
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS role_members (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            role_key  TEXT NOT NULL,
            name      TEXT NOT NULL,
            open_id   TEXT NOT NULL,
            UNIQUE(role_key, open_id)
        )
    ''')
    conn.commit()
    conn.close()


init_db()
auth = Auth(FEISHU_HOST, APP_ID, APP_SECRET)


@app.errorhandler(Exception)
def auth_error_handler(ex):
    print(f"Error: {ex}")
    return jsonify(message=str(ex)), 500


@app.route("/",          methods=["GET"])
def get_home():           return render_template("index.html", app_id=APP_ID)

@app.route("/checkout",  methods=["GET"])
def get_checkout_page():  return render_template("checkout.html")

@app.route("/query",     methods=["GET"])
def get_query_page():     return render_template("query.html")

@app.route("/import",    methods=["GET"])
def import_page():        return render_template("import.html")

@app.route("/settings",  methods=["GET"])
def settings_page():      return render_template("settings.html")

@app.route("/api/login", methods=["POST"])
def feishu_login():
    body = request.get_json()
    code = body.get("code")
    if not code:
        return jsonify({"code": -1, "msg": "缺少授权码 code"})

    # 1. 确保拿到最新的 tenant_access_token
    auth._refresh_token_if_needed()

    # 2. 用 code 换取 user_access_token 和 用户身份信息
    url = f"{FEISHU_HOST}/open-apis/authen/v1/access_token"
    headers = {
        "Authorization": f"Bearer {auth.tenant_access_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "grant_type": "authorization_code",
        "code": code
    }

    try:
        resp = requests.post(url, headers=headers, json=payload, timeout=10).json()
        if resp.get("code") == 0:
            data = resp.get("data", {})
            return jsonify({
                "code": 0,
                "data": {
                    "openId": data.get("open_id"),  # 真实唯一标识
                    "nickName": data.get("name"),  # 真实姓名
                    "avatarUrl": data.get("avatar_url")  # 头像
                }
            })
        else:
            return jsonify({"code": -1, "msg": f"获取用户信息失败: {resp.get('msg')}"})
    except Exception as e:
        return jsonify({"code": -1, "msg": f"请求飞书API异常: {str(e)}"})

@app.route("/get_config_parameters", methods=["GET"])
def get_config_parameters():
    url       = request.args.get("url")
    ticket    = auth.get_ticket()
    timestamp = int(time.time()) * 1000
    verify_str = "jsapi_ticket={}&noncestr={}&timestamp={}&url={}".format(
        ticket, NONCE_STR, timestamp, url)
    signature = hashlib.sha1(verify_str.encode("utf-8")).hexdigest()
    return jsonify({"appid": APP_ID, "signature": signature,
                    "noncestr": NONCE_STR, "timestamp": timestamp})


@app.route("/api/order/<borrow_order_id>", methods=["GET"])
def get_order_detail(borrow_order_id):
    conn = get_conn()
    rows = conn.execute(
        'SELECT * FROM drawing_records WHERE borrow_order_id = ? '
        'ORDER BY CAST(seq_no AS INTEGER)',
        (borrow_order_id,)
    ).fetchall()
    conn.close()

    if not rows:
        return jsonify({"code": 1, "msg": "借用单不存在，请先导入", "data": []})

    data      = [dict(r) for r in rows]
    non_draw  = [r for r in data if r['status'] != STATUS_NODRAW]
    all_out   = bool(non_draw) and all(r['status'] == STATUS_OUT for r in non_draw)
    has_draft = any(r['status'] == STATUS_DRAFT for r in data)

    return jsonify({"code": 0, "msg": "ok", "data": data,
                    "all_out": all_out, "has_draft": has_draft})


@app.route("/api/drafts", methods=["GET"])
def get_drafts():
    conn = get_conn()
    rows = conn.execute(
        '''SELECT borrow_order_id,
                  MAX(borrow_time) AS saved_at,
                  COUNT(*)         AS draft_count
           FROM drawing_records
           WHERE status = ?
           GROUP BY borrow_order_id
           ORDER BY saved_at DESC''',
        (STATUS_DRAFT,)
    ).fetchall()
    conn.close()
    return jsonify({"code": 0, "data": [dict(r) for r in rows]})


@app.route("/api/save_draft", methods=["POST"])
def save_draft():
    body            = request.get_json()
    borrow_order_id = body.get("borrow_order_id")
    scanned_nos     = body.get("scanned_chart_nos", [])

    if not borrow_order_id:
        return jsonify({"code": -1, "msg": "缺少借用单号"})

    saved_at = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    conn.execute(
        "UPDATE drawing_records SET status=?, borrow_time=NULL "
        "WHERE borrow_order_id=? AND status=?",
        (STATUS_PENDING, borrow_order_id, STATUS_DRAFT)
    )
    if scanned_nos:
        ph = ','.join('?' * len(scanned_nos))
        conn.execute(
            f"UPDATE drawing_records SET status=?, borrow_time=? "
            f"WHERE borrow_order_id=? AND chart_no IN ({ph}) AND status!=?",
            [STATUS_DRAFT, saved_at, borrow_order_id] + scanned_nos + [STATUS_NODRAW]
        )
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "草稿已保存", "saved_at": saved_at})


@app.route("/api/submit_order", methods=["POST"])
def submit_order():
    body = request.get_json()
    borrow_order_id   = body.get("borrow_order_id")
    borrower_name     = body.get("borrower_name", "")
    borrower_id       = body.get("borrower_id", "")
    lend_manager_name = body.get("lend_manager_name", "")
    lend_manager_id   = body.get("lend_manager_id", "")

    if not borrow_order_id or not borrower_name:
        return jsonify({"code": -1, "msg": "借用单号和借用人不能为空"})

    borrow_time = time.strftime("%Y-%m-%d %H:%M:%S")
    conn = get_conn()
    conn.execute(
        '''UPDATE drawing_records
           SET status            = ?,
               borrower_name     = ?,
               borrower_id       = ?,
               lend_manager_name = ?,
               lend_manager_id   = ?,
               borrow_time       = ?
           WHERE borrow_order_id = ? AND status != ?''',
        (STATUS_OUT, borrower_name, borrower_id,
         lend_manager_name, lend_manager_id, borrow_time,
         borrow_order_id, STATUS_NODRAW)
    )
    conn.commit()
    conn.close()
    return jsonify({"code": 0, "msg": "提交成功", "borrow_time": borrow_time})


@app.route("/api/upload_excel", methods=["POST"])
def upload_excel():
    if 'file' not in request.files:
        return jsonify({"code": -1, "msg": "未找到文件"})

    file             = request.files['file']
    display_filename = request.form.get('filename') or file.filename

    match = re.search(r'导入借用单_(.+?)\.xlsx$', display_filename, re.IGNORECASE)
    if not match:
        return jsonify({"code": -1, "msg": "文件名格式不正确，应为「导入借用单_单号.xlsx」"})

    borrow_order_id = match.group(1).strip()

    try:
        df = pd.read_excel(file)
        df = df.fillna("")

        conn = get_conn()
        out_count = conn.execute(
            "SELECT COUNT(*) FROM drawing_records WHERE borrow_order_id=? AND status=?",
            (borrow_order_id, STATUS_OUT)
        ).fetchone()[0]
        if out_count > 0:
            conn.close()
            return jsonify({"code": -1, "msg": f"单号 {borrow_order_id} 已有借出记录，无法重新导入"})

        conn.execute('DELETE FROM drawing_records WHERE borrow_order_id=?', (borrow_order_id,))
        count = 0
        for _, row in df.iterrows():
            page_format    = str(row.get('幅面', '')).strip()
            initial_status = STATUS_NODRAW if page_format == '无图' else STATUS_PENDING
            conn.execute('''
                INSERT INTO drawing_records
                    (borrow_order_id, seq_no, work_order_id, chart_no,
                     purpose, page_format, drawing_type, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                borrow_order_id,
                str(row.get('序号', '')),
                str(row.get('工作令号', '')),
                str(row.get('图号', '')),
                str(row.get('用途', '')),
                page_format,
                str(row.get('类型', '')),
                initial_status
            ))
            count += 1

        conn.commit()
        conn.close()
        return jsonify({"code": 0, "msg": f"单号 {borrow_order_id} 导入成功，共 {count} 条记录"})

    except Exception as e:
        print(f"解析出错: {e}")
        return jsonify({"code": -1, "msg": f"解析失败: {str(e)}"})


@app.route("/api/settings/roles", methods=["GET"])
def get_roles():
    conn = get_conn()
    rows = conn.execute(
        'SELECT role_key, name, open_id FROM role_members ORDER BY id'
    ).fetchall()
    conn.close()
    data = {}
    for row in rows:
        key = row['role_key']
        if key not in data:
            data[key] = []
        data[key].append({'name': row['name'], 'open_id': row['open_id']})
    return jsonify({'code': 0, 'data': data})


@app.route("/api/settings/roles", methods=["POST"])
def save_roles():
    body  = request.get_json()
    roles = body.get('roles', {})
    if not isinstance(roles, dict):
        return jsonify({'code': -1, 'msg': '数据格式错误'})
    conn = get_conn()
    try:
        conn.execute('DELETE FROM role_members')
        for role_key, members in roles.items():
            if not isinstance(members, list):
                continue
            for m in members:
                name    = (m.get('name') or '').strip()
                open_id = (m.get('open_id') or '').strip()
                if not name:
                    continue
                conn.execute(
                    'INSERT OR IGNORE INTO role_members (role_key, name, open_id) VALUES (?,?,?)',
                    (role_key, name, open_id)
                )
        conn.commit()
    except Exception as e:
        conn.rollback()
        conn.close()
        return jsonify({'code': -1, 'msg': f'保存失败: {str(e)}'})
    conn.close()
    return jsonify({'code': 0, 'msg': '保存成功'})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3000, debug=True, use_reloader=False)