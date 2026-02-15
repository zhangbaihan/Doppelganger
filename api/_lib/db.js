import { createClient } from '@libsql/client';

let _db;
let _initialized = false;

function getDb() {
  if (!_db) {
    _db = createClient({
      url: process.env.TURSO_DATABASE_URL,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return _db;
}

export async function initDb() {
  if (_initialized) return getDb();
  const db = getDb();

  await db.execute(`
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
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_message TEXT NOT NULL,
      agent_response TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations: add columns if missing
  const migrations = [
    `ALTER TABLE users ADD COLUMN profile_data TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN confidence_reasoning TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN knowledge_base TEXT DEFAULT NULL`,
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* already exists */ }
  }

  _initialized = true;
  return db;
}

export async function getUserByGoogleId(googleId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE google_id = ?',
    args: [googleId],
  });
  return result.rows[0] || null;
}

export async function getUserById(id) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM users WHERE id = ?',
    args: [id],
  });
  return result.rows[0] || null;
}

export async function createUser(googleId, email, name) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO users (google_id, email, name) VALUES (?, ?, ?)',
    args: [googleId, email, name],
  });
  return getUserById(Number(result.lastInsertRowid));
}

export async function updateUser(id, data) {
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(id);
  await db.execute({
    sql: `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    args: values,
  });
}

export async function getConversations(userId, limit = 50) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT ?',
    args: [userId, limit],
  });
  return result.rows;
}

export async function addConversation(userId, userMessage, agentResponse) {
  const db = await initDb();
  await db.execute({
    sql: 'INSERT INTO conversations (user_id, user_message, agent_response) VALUES (?, ?, ?)',
    args: [userId, userMessage, agentResponse],
  });
}

export function parseUser(user) {
  if (!user) return null;
  return {
    ...user,
    id: Number(user.id),
    is_trained: Number(user.is_trained),
    questions_covered: JSON.parse(user.questions_covered || '[]'),
    confidence_scores: JSON.parse(
      user.confidence_scores ||
        '{"identity_resolution":0,"behavioral_specificity":0,"emotional_resolution":0,"social_pattern_clarity":0}'
    ),
    profile_data: JSON.parse(user.profile_data || 'null'),
    confidence_reasoning: JSON.parse(user.confidence_reasoning || 'null'),
    knowledge_base: JSON.parse(user.knowledge_base || 'null'),
  };
}
