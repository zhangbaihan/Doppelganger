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

    CREATE TABLE IF NOT EXISTS simulations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT,
      config TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      num_simulations INTEGER DEFAULT 1,
      current_sim_index INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS simulation_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id INTEGER NOT NULL,
      run_index INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (simulation_id) REFERENCES simulations(id)
    );

    CREATE TABLE IF NOT EXISTS simulation_states (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_run_id INTEGER NOT NULL,
      state_index INTEGER NOT NULL,
      agent_positions TEXT NOT NULL,
      transcript TEXT NOT NULL,
      items TEXT,
      narrative_events TEXT,
      timestamp REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (simulation_run_id) REFERENCES simulation_runs(id)
    );

    CREATE TABLE IF NOT EXISTS simulation_participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      simulation_id INTEGER NOT NULL,
      user_id INTEGER,
      is_random INTEGER DEFAULT 0,
      role TEXT,
      FOREIGN KEY (simulation_id) REFERENCES simulations(id),
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

/* ── Simulation functions ────────────────────────────────────────── */

export function createSimulation(userId, name, config, numSimulations) {
  const stmt = db.prepare(
    'INSERT INTO simulations (user_id, name, config, num_simulations) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(userId, name, JSON.stringify(config), numSimulations);
  return result.lastInsertRowid;
}

export function getSimulation(simulationId) {
  return db.prepare('SELECT * FROM simulations WHERE id = ?').get(simulationId);
}

export function getSimulationsByUserId(userId) {
  return db.prepare('SELECT * FROM simulations WHERE user_id = ? ORDER BY created_at DESC').all(userId);
}

export function updateSimulation(simulationId, data) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(simulationId);
  db.prepare(`UPDATE simulations SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function createSimulationRun(simulationId, runIndex) {
  const stmt = db.prepare(
    'INSERT INTO simulation_runs (simulation_id, run_index, status) VALUES (?, ?, ?)'
  );
  const result = stmt.run(simulationId, runIndex, 'pending');
  return result.lastInsertRowid;
}

export function getSimulationRun(runId) {
  return db.prepare('SELECT * FROM simulation_runs WHERE id = ?').get(runId);
}

export function getSimulationRuns(simulationId) {
  return db
    .prepare('SELECT * FROM simulation_runs WHERE simulation_id = ? ORDER BY run_index ASC')
    .all(simulationId);
}

export function updateSimulationRun(runId, data) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }
  values.push(runId);
  db.prepare(`UPDATE simulation_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
}

export function addSimulationState(runId, stateIndex, agentPositions, transcript, items, narrativeEvents, timestamp) {
  db.prepare(
    'INSERT INTO simulation_states (simulation_run_id, state_index, agent_positions, transcript, items, narrative_events, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    runId,
    stateIndex,
    JSON.stringify(agentPositions),
    transcript,
    items ? JSON.stringify(items) : null,
    narrativeEvents ? JSON.stringify(narrativeEvents) : null,
    timestamp
  );
}

export function getSimulationStates(runId) {
  return db
    .prepare('SELECT * FROM simulation_states WHERE simulation_run_id = ? ORDER BY state_index ASC')
    .all(runId);
}

export function addSimulationParticipant(simulationId, userId, isRandom, role) {
  db.prepare(
    'INSERT INTO simulation_participants (simulation_id, user_id, is_random, role) VALUES (?, ?, ?, ?)'
  ).run(simulationId, userId, isRandom ? 1 : 0, role);
}

export function getSimulationParticipants(simulationId) {
  return db
    .prepare('SELECT * FROM simulation_participants WHERE simulation_id = ?')
    .all(simulationId);
}

export function deleteSimulation(simulationId) {
  // Delete in order: states -> runs -> participants -> simulation
  const runs = getSimulationRuns(simulationId);
  for (const run of runs) {
    db.prepare('DELETE FROM simulation_states WHERE simulation_run_id = ?').run(run.id);
  }
  db.prepare('DELETE FROM simulation_runs WHERE simulation_id = ?').run(simulationId);
  db.prepare('DELETE FROM simulation_participants WHERE simulation_id = ?').run(simulationId);
  db.prepare('DELETE FROM simulations WHERE id = ?').run(simulationId);
}

export function getAllUsers() {
  return db.prepare('SELECT id, name, bit_name, is_trained FROM users WHERE bit_name IS NOT NULL').all();
}
