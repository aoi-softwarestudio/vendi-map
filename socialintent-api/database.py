# -*- coding: utf-8 -*-
import sqlite3
import os
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "socialintent.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initialize SQLite database tables if they do not exist."""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # 1. Create licenses table with transaction_id to link with Stripe sessions
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS licenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        license_key TEXT UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled'
        email TEXT NOT NULL,
        transaction_id TEXT, -- Stripe Session ID
        created_at TEXT NOT NULL,
        activated_at TEXT
    )
    """)
    
    # 2. Create transactions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        amount INTEGER NOT NULL,
        status TEXT NOT NULL, -- 'completed', 'pending', 'failed'
        created_at TEXT NOT NULL
    )
    """)
    
    # 3. Create X replied posts tracking table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS x_replied_posts (
        tweet_id TEXT PRIMARY KEY,
        author_id TEXT,
        keyword TEXT,
        replied_at TEXT NOT NULL
    )
    """)
    
    # 4. Create X DM sent logs tracking table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS x_dm_sent_logs (
        user_id TEXT PRIMARY KEY,
        last_sent_at TEXT NOT NULL
    )
    """)
    
    # 5. Create X posted threads tracking table to map tweet IDs to keywords
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS x_posted_threads (
        tweet_id TEXT PRIMARY KEY,
        keyword TEXT NOT NULL,
        posted_at TEXT NOT NULL
    )
    """)
    
    # 6. Create cached trends table for programmatic SEO
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cached_trends (
        keyword TEXT PRIMARY KEY,
        analysis_json TEXT NOT NULL,
        cached_at TEXT NOT NULL
    )
    """)
    
    conn.commit()
    conn.close()
    print("Database initialized successfully at:", DB_PATH)

def create_license(license_key, email, transaction_id=None):
    """Insert a new active license key into the database."""
    conn = get_db_connection()
    cursor = conn.cursor()
    created_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO licenses (license_key, status, email, transaction_id, created_at) VALUES (?, 'active', ?, ?, ?)",
            (license_key, email, transaction_id, created_at)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def get_license_by_transaction(transaction_id):
    """Retrieve license key information by its transaction_id (Stripe Session ID)."""
    conn = get_db_connection()
    cursor = conn.cursor()
    row = cursor.execute(
        "SELECT * FROM licenses WHERE transaction_id = ?",
        (transaction_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

import hmac
import hashlib

LICENSE_SALT = os.environ.get("LICENSE_SIGNING_SALT", "aoi_software_studio_secret_salt")

def verify_cryptographic_license(license_key):
    """
    Verify if the license key is cryptographically valid without database access.
    Format: LS-PREMIUM-XXXX-XXXX where the second part is a hash of the first part.
    """
    try:
        parts = license_key.strip().upper().split("-")
        if len(parts) != 4 or parts[0] != "LS" or parts[1] != "PREMIUM":
            return False
            
        part1 = parts[2]
        part2 = parts[3]
        
        if len(part1) != 4 or len(part2) != 4:
            return False
            
        h = hmac.new(LICENSE_SALT.encode("utf-8"), part1.encode("utf-8"), hashlib.sha256)
        expected_sig = h.hexdigest().upper()[:4]
        
        return hmac.compare_digest(part2, expected_sig)
    except Exception:
        return False

def validate_license(license_key):
    """Check if the license key exists and is active, with cryptographic fallback."""
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        row = cursor.execute(
            "SELECT * FROM licenses WHERE license_key = ? AND status = 'active'",
            (license_key,)
        ).fetchone()
        
        if row:
            # Update activated_at timestamp if not set yet
            if not row["activated_at"]:
                activated_at = datetime.datetime.now().isoformat()
                cursor.execute(
                    "UPDATE licenses SET activated_at = ? WHERE license_key = ?",
                    (activated_at, license_key)
                )
                conn.commit()
            return True
    except Exception as e:
        print(f"Database query failed during validation: {e}")
    finally:
        conn.close()
        
    # Stateless cryptographic fallback
    return verify_cryptographic_license(license_key)

def record_transaction(transaction_id, email, amount, status):
    """Record payment transaction history."""
    conn = get_db_connection()
    cursor = conn.cursor()
    created_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO transactions (transaction_id, email, amount, status, created_at) VALUES (?, ?, ?, ?, ?)",
            (transaction_id, email, amount, status, created_at)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()


def record_x_reply(tweet_id, author_id, keyword):
    """Record that we have replied to a specific tweet to avoid double replying."""
    conn = get_db_connection()
    cursor = conn.cursor()
    replied_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO x_replied_posts (tweet_id, author_id, keyword, replied_at) VALUES (?, ?, ?, ?)",
            (tweet_id, author_id, keyword, replied_at)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def is_x_replied(tweet_id):
    """Check if we have already replied to this tweet."""
    conn = get_db_connection()
    cursor = conn.cursor()
    row = cursor.execute(
        "SELECT 1 FROM x_replied_posts WHERE tweet_id = ?",
        (tweet_id,)
    ).fetchone()
    conn.close()
    return row is not None

def record_x_dm_sent(user_id):
    """Record/Update when we last sent a DM to a user to avoid spamming."""
    conn = get_db_connection()
    cursor = conn.cursor()
    last_sent_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO x_dm_sent_logs (user_id, last_sent_at) VALUES (?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at",
            (user_id, last_sent_at)
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Failed to record X DM sent log: {e}")
        return False
    finally:
        conn.close()

def get_last_x_dm_time(user_id):
    """Get the timestamp when we last sent a DM to this user."""
    conn = get_db_connection()
    cursor = conn.cursor()
    row = cursor.execute(
        "SELECT last_sent_at FROM x_dm_sent_logs WHERE user_id = ?",
        (user_id,)
    ).fetchone()
    conn.close()
    return row["last_sent_at"] if row else None

def record_x_posted_thread(tweet_id, keyword):
    """Record a posted tweet ID mapped to its analyzed keyword."""
    conn = get_db_connection()
    cursor = conn.cursor()
    posted_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO x_posted_threads (tweet_id, keyword, posted_at) VALUES (?, ?, ?)",
            (tweet_id, keyword, posted_at)
        )
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def get_x_posted_thread_keyword(tweet_id):
    """Get the keyword mapped to a posted tweet ID."""
    conn = get_db_connection()
    cursor = conn.cursor()
    row = cursor.execute(
        "SELECT keyword FROM x_posted_threads WHERE tweet_id = ?",
        (tweet_id,)
    ).fetchone()
    conn.close()
    return row["keyword"] if row else None

def get_cached_trend(keyword):
    """Retrieve cached trend analysis JSON for programmatic SEO."""
    conn = get_db_connection()
    cursor = conn.cursor()
    row = cursor.execute(
        "SELECT analysis_json FROM cached_trends WHERE keyword = ?",
        (keyword,)
    ).fetchone()
    conn.close()
    return row["analysis_json"] if row else None

def cache_trend(keyword, analysis_json):
    """Insert or update trend analysis JSON in cache."""
    conn = get_db_connection()
    cursor = conn.cursor()
    cached_at = datetime.datetime.now().isoformat()
    try:
        cursor.execute(
            "INSERT INTO cached_trends (keyword, analysis_json, cached_at) VALUES (?, ?, ?) "
            "ON CONFLICT(keyword) DO UPDATE SET analysis_json = excluded.analysis_json, cached_at = excluded.cached_at",
            (keyword, analysis_json, cached_at)
        )
        conn.commit()
        return True
    except Exception as e:
        print(f"Database: Failed to cache trend for keyword '{keyword}': {e}")
        return False
    finally:
        conn.close()

