"""
FlowTrack Database Initializer (SQLite3)
Creates flowtrack.db with full schema for user accounts, credentials,
custom DP images, user preferences, and productivity data.
"""

import sqlite3
import hashlib
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'flowtrack.db')

def hash_password(password: str) -> str:
    """Hash password using SHA-256 with salt."""
    salt = "flowtrack_secure_salt_2026_"
    return hashlib.sha256((salt + password).encode('utf-8')).hexdigest()

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")
    return conn

def init_database():
    print(f"Initializing FlowTrack SQLite database at: {DB_PATH}")
    conn = get_connection()
    cursor = conn.cursor()

    # 1. Users Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        password_plain TEXT,
        role TEXT DEFAULT 'Focus Champion',
        status TEXT DEFAULT 'Focus Champion',
        avatar TEXT DEFAULT '⚡',
        avatar_photo TEXT,
        logo_image TEXT,
        logo_icon TEXT DEFAULT '🌿',
        preferences TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. User State Table (stores user's complete productivity state: goals, timetable, habits, checks)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS user_state (
        user_id INTEGER PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 3. Auth Sessions Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 4. Habits Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS habits (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        emoji TEXT DEFAULT '🎯',
        done_by_date TEXT DEFAULT '{}',
        target INTEGER DEFAULT 7,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # 5. Timetable Checks Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS timetable_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        check_key TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, check_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """)

    # Seed default user 'michal_masiak' if table is empty
    cursor.execute("SELECT id FROM users WHERE username = 'michal_masiak'")
    existing = cursor.fetchone()

    if not existing:
        default_pwd = '13579'
        cursor.execute("""
        INSERT INTO users (
            username, name, email, password_hash, password_plain, role, status, avatar, logo_icon, preferences
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            'michal_masiak',
            'Michał Masiak',
            'michal.masiak@anywhere.co',
            hash_password(default_pwd),
            default_pwd,
            'Focus Champion',
            'Focus Champion',
            '⚡',
            '🌿',
            json.dumps({
                "timeFormat": "12",
                "checkSounds": True,
                "autoCheckPrompt": True
            })
        ))
        print("✓ Created default user account: michal_masiak (PIN: 13579)")

    conn.commit()
    conn.close()
    print("✓ FlowTrack SQLite database initialized successfully!")

if __name__ == '__main__':
    init_database()
