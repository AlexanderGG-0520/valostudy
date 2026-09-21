import json
import sqlite3
import time
from contextlib import contextmanager

class Store:
    def __init__(self, path):
        self.path = path
        with self.connection() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, body TEXT NOT NULL)')
            db.execute('CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, created REAL NOT NULL, body TEXT NOT NULL)')

    @contextmanager
    def connection(self):
        with sqlite3.connect(self.path, timeout=10) as db:
            yield db

    def create(self, data):
        data['created'] = time.time()
        with self.connection() as db:
            db.execute('INSERT INTO sessions VALUES (?,?,?)', (data['id'], data['created'], json.dumps(data)))
        return data

    def get(self, sid):
        with self.connection() as db:
            row = db.execute('SELECT body FROM sessions WHERE id=?', (sid,)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self):
        with self.connection() as db:
            rows = db.execute('SELECT body FROM sessions ORDER BY created DESC').fetchall()
        return [json.loads(row[0]) for row in rows]

    def update(self, sid, **changes):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT body FROM sessions WHERE id=?', (sid,)).fetchone()
            if not row:
                raise KeyError(sid)
            data = json.loads(row[0])
            data.update(changes)
            db.execute('UPDATE sessions SET body=? WHERE id=?', (json.dumps(data), sid))
        return data

    def delete(self, sid):
        with self.connection() as db:
            db.execute('DELETE FROM sessions WHERE id=?', (sid,))

    def create_share(self, data):
        with self.connection() as db:
            db.execute('INSERT INTO shares VALUES (?,?,?)', (data['id'], data['session_id'], json.dumps(data)))

    def share(self, share_id):
        with self.connection() as db:
            row = db.execute('SELECT body FROM shares WHERE id=?', (share_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def shares(self, sid):
        with self.connection() as db:
            rows = db.execute('SELECT body FROM shares WHERE session_id=?', (sid,)).fetchall()
        return [{k: v for k, v in json.loads(r[0]).items() if k in ('id', 'expires', 'revoked')} for r in rows]

    def revoke(self, share_id):
        with self.connection() as db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT body FROM shares WHERE id=?', (share_id,)).fetchone()
            if row:
                data = json.loads(row[0])
                data['revoked'] = True
                db.execute('UPDATE shares SET body=? WHERE id=?', (json.dumps(data), share_id))

    def revoke_for_session(self, sid):
        with self.connection() as db:
            db.execute('DELETE FROM shares WHERE session_id=?', (sid,))
