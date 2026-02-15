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

  await db.execute(`
    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT,
      config TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      num_simulations INTEGER DEFAULT 1,
      current_sim_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS simulation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id INTEGER NOT NULL,
      run_index INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS simulation_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_run_id INTEGER NOT NULL,
      state_index INTEGER NOT NULL,
      agent_positions TEXT NOT NULL,
      transcript TEXT NOT NULL,
      items TEXT,
      narrative_events TEXT,
      timestamp REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS simulation_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id INTEGER NOT NULL,
      user_id INTEGER,
      is_random INTEGER DEFAULT 0,
      role TEXT
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

/* ── User functions ──────────────────────────────────────────────── */

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

export async function getAllUsers() {
  const db = await initDb();
  const result = await db.execute(
    "SELECT id, name, bit_name, is_trained FROM users WHERE bit_name IS NOT NULL"
  );
  return result.rows;
}

/* ── Simulation functions ────────────────────────────────────────── */

export async function createSimulation(userId, name, config, numSimulations) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO simulations (user_id, name, config, num_simulations) VALUES (?, ?, ?, ?)',
    args: [userId, name, JSON.stringify(config), numSimulations],
  });
  return Number(result.lastInsertRowid);
}

export async function getSimulation(simulationId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulations WHERE id = ?',
    args: [simulationId],
  });
  return result.rows[0] || null;
}

export async function getSimulationsByUserId(userId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulations WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return result.rows;
}

export async function updateSimulation(simulationId, data) {
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(simulationId);
  await db.execute({
    sql: `UPDATE simulations SET ${fields.join(', ')} WHERE id = ?`,
    args: values,
  });
}

export async function createSimulationRun(simulationId, runIndex) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO simulation_runs (simulation_id, run_index, status) VALUES (?, ?, ?)',
    args: [simulationId, runIndex, 'pending'],
  });
  return Number(result.lastInsertRowid);
}

export async function getSimulationRun(runId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulation_runs WHERE id = ?',
    args: [runId],
  });
  return result.rows[0] || null;
}

export async function getSimulationRuns(simulationId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulation_runs WHERE simulation_id = ? ORDER BY run_index ASC',
    args: [simulationId],
  });
  return result.rows;
}

export async function updateSimulationRun(runId, data) {
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(runId);
  await db.execute({
    sql: `UPDATE simulation_runs SET ${fields.join(', ')} WHERE id = ?`,
    args: values,
  });
}

export async function addSimulationState(runId, stateIndex, agentPositions, transcript, items, narrativeEvents, timestamp) {
  const db = await initDb();
  await db.execute({
    sql: 'INSERT INTO simulation_states (simulation_run_id, state_index, agent_positions, transcript, items, narrative_events, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [
      runId,
      stateIndex,
      JSON.stringify(agentPositions),
      transcript,
      items ? JSON.stringify(items) : null,
      narrativeEvents ? JSON.stringify(narrativeEvents) : null,
      timestamp,
    ],
  });
}

export async function getSimulationStates(runId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulation_states WHERE simulation_run_id = ? ORDER BY state_index ASC',
    args: [runId],
  });
  return result.rows;
}

export async function addSimulationParticipant(simulationId, userId, isRandom, role) {
  const db = await initDb();
  await db.execute({
    sql: 'INSERT INTO simulation_participants (simulation_id, user_id, is_random, role) VALUES (?, ?, ?, ?)',
    args: [simulationId, userId, isRandom ? 1 : 0, role],
  });
}

export async function getSimulationParticipants(simulationId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM simulation_participants WHERE simulation_id = ?',
    args: [simulationId],
  });
  return result.rows;
}

export async function deleteSimulation(simulationId) {
  const db = await initDb();
  // Get runs first
  const runsResult = await db.execute({
    sql: 'SELECT id FROM simulation_runs WHERE simulation_id = ?',
    args: [simulationId],
  });
  // Delete states for each run
  for (const run of runsResult.rows) {
    await db.execute({
      sql: 'DELETE FROM simulation_states WHERE simulation_run_id = ?',
      args: [Number(run.id)],
    });
  }
  await db.execute({
    sql: 'DELETE FROM simulation_runs WHERE simulation_id = ?',
    args: [simulationId],
  });
  await db.execute({
    sql: 'DELETE FROM simulation_participants WHERE simulation_id = ?',
    args: [simulationId],
  });
  await db.execute({
    sql: 'DELETE FROM simulations WHERE id = ?',
    args: [simulationId],
  });
}

/* ── Parse helpers ───────────────────────────────────────────────── */

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
