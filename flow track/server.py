#!/usr/bin/env python3
"""
FlowTrack Local SQLite Web & API Server
Zero external dependencies — runs on standard Python 3.
Serves static files and provides a REST API backed by flowtrack.db (SQLite3).
"""

import os
import sys
import json
import sqlite3
import hashlib
import secrets
import mimetypes
from datetime import datetime, timedelta
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, 'flowtrack.db')
HOST = '127.0.0.1'
PORT = 5000

SALT = "flowtrack_secure_salt_2026_"

def hash_password(password: str) -> str:
    return hashlib.sha256((SALT + str(password).strip()).encode('utf-8')).hexdigest()

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn

def init_db_if_needed():
    import init_db
    init_db.init_database()

init_db_if_needed()

class FlowTrackRequestHandler(BaseHTTPRequestHandler):
    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-Session-Token')

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()

    def send_json(self, status_code: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_cors_headers()
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        content_len = int(self.headers.get('Content-Length', 0))
        if content_len <= 0:
            return {}
        raw = self.rfile.read(content_len).decode('utf-8')
        try:
            return json.loads(raw)
        except Exception:
            return {}

    def get_auth_user(self):
        token = self.headers.get('X-Session-Token') or self.headers.get('Authorization')
        if not token:
            return None
        if token.startswith('Bearer '):
            token = token[7:].strip()
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT u.* FROM users u
            JOIN sessions s ON u.id = s.user_id
            WHERE s.token = ?
        """, (token,))
        row = cur.fetchone()
        conn.close()
        return dict(row) if row else None

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # ── API ENDPOINTS ──
        if path == '/api/db/status':
            conn = get_db()
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM users")
            user_count = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM user_state")
            state_count = cur.fetchone()[0]
            conn.close()
            self.send_json(200, {
                "status": "connected",
                "database": "SQLite 3",
                "db_file": "flowtrack.db",
                "db_path": DB_PATH,
                "users_count": user_count,
                "states_saved": state_count,
                "timestamp": datetime.now().isoformat()
            })
            return

        if path == '/api/users':
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                SELECT id, username, name, email, role, status, avatar, 
                       (avatar_photo IS NOT NULL AND length(avatar_photo) > 0) AS has_custom_dp,
                       created_at, last_login 
                FROM users ORDER BY id ASC
            """)
            users = [dict(r) for r in cur.fetchall()]
            conn.close()
            self.send_json(200, {"users": users})
            return

        if path == '/api/user/profile':
            user = self.get_auth_user()
            if not user:
                # If no session token, check for ?username= query parameter
                qs = parse_qs(parsed.query)
                username = qs.get('username', [None])[0]
                if username:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (username,))
                    row = cur.fetchone()
                    conn.close()
                    if row:
                        user = dict(row)
            if not user:
                self.send_json(401, {"error": "Unauthorized or user not found"})
                return

            prefs = {}
            if user.get('preferences'):
                try:
                    prefs = json.loads(user['preferences'])
                except Exception:
                    pass

            safe_user = {
                "id": user["id"],
                "username": user["username"],
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
                "status": user["status"],
                "avatar": user["avatar"],
                "avatarPhoto": user["avatar_photo"],
                "logoImage": user["logo_image"],
                "logoIcon": user["logo_icon"],
                "preferences": prefs,
                "createdAt": user["created_at"],
                "lastLogin": user["last_login"]
            }
            self.send_json(200, {"user": safe_user})
            return

        if path == '/api/user/state':
            user = self.get_auth_user()
            if not user:
                qs = parse_qs(parsed.query)
                username = qs.get('username', [None])[0]
                if username:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT id FROM users WHERE username = ? COLLATE NOCASE", (username,))
                    r = cur.fetchone()
                    conn.close()
                    if r:
                        user = {"id": r[0]}
            if not user:
                self.send_json(401, {"error": "Unauthorized"})
                return

            conn = get_db()
            cur = conn.cursor()
            cur.execute("SELECT state_json, updated_at FROM user_state WHERE user_id = ?", (user["id"],))
            row = cur.fetchone()
            conn.close()
            if row:
                try:
                    state_obj = json.loads(row["state_json"])
                    self.send_json(200, {"state": state_obj, "updated_at": row["updated_at"]})
                except Exception:
                    self.send_json(200, {"state": None})
            else:
                self.send_json(200, {"state": None})
            return

        # ── STATIC FILE SERVING ──
        clean_path = path.lstrip('/')
        if not clean_path or clean_path == '/':
            clean_path = 'index.html'

        file_path = os.path.join(BASE_DIR, clean_path)
        if not os.path.isfile(file_path):
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'404 Not Found')
            return

        mime_type, _ = mimetypes.guess_type(file_path)
        if not mime_type:
            if file_path.endswith('.css'):
                mime_type = 'text/css'
            elif file_path.endswith('.js'):
                mime_type = 'application/javascript'
            elif file_path.endswith('.json'):
                mime_type = 'application/json'
            else:
                mime_type = 'application/octet-stream'

        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            self.send_response(200)
            self.send_cors_headers()
            self.send_header('Content-Type', mime_type)
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f'Server Error: {str(e)}'.encode('utf-8'))

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        body = self.read_json_body()

        # ── 1. REGISTER USER ──
        if path == '/api/register':
            raw_username = body.get('username', '').strip().lstrip('@')
            name = body.get('name', '').strip()
            password = str(body.get('password', '')).strip()
            email = body.get('email', f"{raw_username.lower()}@flowtrack.local").strip()

            if not raw_username:
                self.send_json(400, {"error": "Username is required"})
                return
            if not password:
                self.send_json(400, {"error": "Password is required"})
                return
            if not name:
                name = raw_username.capitalize()

            pwd_hash = hash_password(password)
            avatar = body.get('avatar', '🌱')

            conn = get_db()
            cur = conn.cursor()
            try:
                cur.execute("""
                    INSERT INTO users (username, name, email, password_hash, password_plain, avatar, role, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'Focus Champion', 'Focus Champion')
                """, (raw_username, name, email, pwd_hash, password, avatar))
                user_id = cur.lastrowid

                # Generate session token
                token = secrets.token_hex(24)
                cur.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
                conn.commit()

                user_data = {
                    "id": user_id,
                    "username": raw_username,
                    "name": name,
                    "email": email,
                    "avatar": avatar,
                    "avatarPhoto": None,
                    "logoImage": None,
                    "logoIcon": "🌿",
                    "role": "Focus Champion",
                    "status": "Focus Champion"
                }
                self.send_json(201, {
                    "success": True,
                    "message": f"User @{raw_username} successfully created in SQLite database!",
                    "user": user_data,
                    "token": token
                })
            except sqlite3.IntegrityError:
                self.send_json(409, {"error": f"Username @{raw_username} is already taken in the database"})
            finally:
                conn.close()
            return

        # ── 2. LOGIN USER ──
        if path == '/api/login':
            username = body.get('username', '').strip().lstrip('@')
            password = str(body.get('password', '')).strip()

            if not username or not password:
                self.send_json(400, {"error": "Username and password are required"})
                return

            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                SELECT * FROM users 
                WHERE username = ? COLLATE NOCASE 
                   OR name = ? COLLATE NOCASE
            """, (username, username))
            user = cur.fetchone()

            if not user:
                conn.close()
                self.send_json(401, {"error": "User not found in database. Please register an account."})
                return

            user = dict(user)
            expected_hash = hash_password(password)

            # Match either salted hash or plain text (for initial defaults)
            if user['password_hash'] != expected_hash and user.get('password_plain') != password:
                conn.close()
                self.send_json(401, {"error": "Invalid password or PIN. Please try again."})
                return

            # Update last login & create session token
            token = secrets.token_hex(24)
            cur.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user['id']))
            cur.execute("UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?", (user['id'],))
            conn.commit()
            conn.close()

            prefs = {}
            if user.get('preferences'):
                try:
                    prefs = json.loads(user['preferences'])
                except Exception:
                    pass

            safe_user = {
                "id": user["id"],
                "username": user["username"],
                "name": user["name"],
                "email": user["email"],
                "role": user["role"],
                "status": user["status"],
                "avatar": user["avatar"],
                "avatarPhoto": user["avatar_photo"],
                "logoImage": user["logo_image"],
                "logoIcon": user["logo_icon"],
                "preferences": prefs
            }
            self.send_json(200, {
                "success": True,
                "message": "Authenticated successfully from SQLite database!",
                "user": safe_user,
                "token": token
            })
            return

        # ── 3. UPDATE USER PROFILE (NAME, DP, LOGO, ETC.) ──
        if path == '/api/user/profile':
            user = self.get_auth_user()
            if not user:
                # Fallback to username from body
                uname = body.get('username')
                if uname:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (uname.lstrip('@'),))
                    r = cur.fetchone()
                    conn.close()
                    if r:
                        user = dict(r)
            if not user:
                self.send_json(401, {"error": "Unauthorized"})
                return

            conn = get_db()
            cur = conn.cursor()

            name = body.get('name', user['name'])
            email = body.get('email', user['email'])
            role = body.get('role', user['role'])
            avatar = body.get('avatar', user['avatar'])
            avatar_photo = body.get('avatarPhoto', user.get('avatar_photo'))
            logo_image = body.get('logoImage', user.get('logo_image'))
            logo_icon = body.get('logoIcon', user.get('logo_icon'))
            prefs = body.get('preferences')
            prefs_json = json.dumps(prefs) if prefs is not None else user.get('preferences')

            cur.execute("""
                UPDATE users SET
                    name = ?,
                    email = ?,
                    role = ?,
                    avatar = ?,
                    avatar_photo = ?,
                    logo_image = ?,
                    logo_icon = ?,
                    preferences = ?
                WHERE id = ?
            """, (name, email, role, avatar, avatar_photo, logo_image, logo_icon, prefs_json, user['id']))
            conn.commit()
            conn.close()

            self.send_json(200, {
                "success": True,
                "message": "Profile and custom DP stored into SQLite database successfully!"
            })
            return

        # ── 4. UPDATE SECURITY PIN / PASSWORD ──
        if path == '/api/user/pin':
            user = self.get_auth_user()
            if not user:
                uname = body.get('username')
                if uname:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT * FROM users WHERE username = ? COLLATE NOCASE", (uname.lstrip('@'),))
                    r = cur.fetchone()
                    conn.close()
                    if r:
                        user = dict(r)
            if not user:
                self.send_json(401, {"error": "Unauthorized"})
                return

            new_pin = str(body.get('newPin', '')).strip()
            if not new_pin:
                self.send_json(400, {"error": "New PIN/Password cannot be empty"})
                return

            pwd_hash = hash_password(new_pin)
            conn = get_db()
            cur = conn.cursor()
            cur.execute("UPDATE users SET password_hash = ?, password_plain = ? WHERE id = ?", (pwd_hash, new_pin, user['id']))
            conn.commit()
            conn.close()
            self.send_json(200, {"success": True, "message": "PIN updated in database!"})
            return

        # ── 5. SAVE USER STATE (GOALS, TIMETABLE, HABITS, CHECKS) ──
        if path == '/api/user/state':
            user = self.get_auth_user()
            if not user:
                uname = body.get('username')
                if uname:
                    conn = get_db()
                    cur = conn.cursor()
                    cur.execute("SELECT id FROM users WHERE username = ? COLLATE NOCASE", (uname.lstrip('@'),))
                    r = cur.fetchone()
                    conn.close()
                    if r:
                        user = {"id": r[0]}
            if not user:
                self.send_json(401, {"error": "Unauthorized"})
                return

            state_data = body.get('state')
            if not state_data:
                self.send_json(400, {"error": "State data missing"})
                return

            state_json = json.dumps(state_data, ensure_ascii=False)
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO user_state (user_id, state_json, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    state_json = excluded.state_json,
                    updated_at = CURRENT_TIMESTAMP
            """, (user['id'], state_json))
            conn.commit()
            conn.close()

            self.send_json(200, {"success": True, "message": "User state persisted to SQLite database!"})
            return

        # ── 6. LOGOUT ──
        if path == '/api/logout':
            token = self.headers.get('X-Session-Token')
            if token:
                conn = get_db()
                cur = conn.cursor()
                cur.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                conn.close()
            self.send_json(200, {"success": True, "message": "Session invalidated"})
            return

        self.send_json(404, {"error": f"Unknown endpoint: {path}"})

def run_server():
    server_address = (HOST, PORT)
    try:
        httpd = HTTPServer(server_address, FlowTrackRequestHandler)
    except OSError:
        # If port 5000 is occupied, try 5001
        fallback_port = 5001
        server_address = (HOST, fallback_port)
        httpd = HTTPServer(server_address, FlowTrackRequestHandler)

    actual_port = server_address[1]
    url = f"http://localhost:{actual_port}"
    print("=" * 60)
    print(f"🌿 FlowTrack Database Server Running!")
    print(f"📁 SQLite Database : {DB_PATH}")
    print(f"🌐 Web Application : {url}")
    print(f"🔒 REST API Active : {url}/api/db/status")
    print("=" * 60)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping FlowTrack database server...")
        httpd.server_close()

if __name__ == '__main__':
    run_server()
