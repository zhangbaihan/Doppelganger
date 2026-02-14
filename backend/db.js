import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, 'doppelganger.db');

let db;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_id TEXT UNIQUE NOT NULL,
      email TEXT,
      name TEXT,
      bit_name TEXT,
      is_trained INTEGER DEFAULT 0,
      questions_covered TEXT DEFAULT '[]',
      confidence_scores TEXT DEFAULT '{"identity_resolution":0,"behavioral_specificity":0,"emotional_resolution":0,"social_pattern_clarity":0}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      agent_response TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
}

export function getUserByGoogleId(googleId) {
  return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

export function createUser(googleId, email, name) {
  const stmt = db.prepare('INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)');
  const result = stmt.run(googleId, email, name);
  return getUserById(result.lastInsertRowid);
}

export function updateUser(id, data) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function getConversations(userId, limit = 50) {
  return db
    .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT ?')
    .all(userId, limit);
}

export function addConversation(userId, userMessage, agentResponse) {
  db.prepare('INSERT INTO conversations (user_id, user_message, agent_response) VALUES (?, ?, ?)').run(
    userId,
    userMessage,
    agentResponse
  );
}
