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

  // Playground tables
  await db.execute(`
    CREATE TABLE IF NOT EXISTS playground_world (
      id INTEGER PRIMARY KEY DEFAULT 1,
      world_name TEXT DEFAULT 'Stanford Campus',
      world_config TEXT NOT NULL,
      current_state TEXT NOT NULL,
      last_interaction_hour INTEGER,
      last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS playground_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      agent_name TEXT,
      position_x REAL,
      position_y REAL,
      current_location TEXT,
      status TEXT DEFAULT 'active',
      last_interaction_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS playground_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      interaction_hour INTEGER NOT NULL,
      interaction_date DATE NOT NULL,
      turn_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      started_at DATETIME,
      completed_at DATETIME
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS playground_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interaction_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      agent_role TEXT,
      other_agent_user_id INTEGER,
      response_text TEXT,
      action_type TEXT,
      action_target TEXT,
      location_before TEXT,
      location_after TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS playground_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      interaction_id INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      agent_user_id INTEGER NOT NULL,
      other_agent_user_id INTEGER,
      message TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      transcript_type TEXT NOT NULL,
      messages TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrations: add columns if missing
  const migrations = [
    `ALTER TABLE users ADD COLUMN profile_data TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN confidence_reasoning TEXT DEFAULT NULL`,
    `ALTER TABLE users ADD COLUMN knowledge_base TEXT DEFAULT NULL`,
    `ALTER TABLE conversations ADD COLUMN conversation_type TEXT DEFAULT 'training'`,
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

/** @param {'freestyle'|'training'|null} type - if set, filter by conversation type */
export async function getConversations(userId, limit = 50, type = null) {
  const db = await initDb();
  if (type) {
    const result = await db.execute({
      sql: 'SELECT * FROM conversations WHERE user_id = ? AND conversation_type = ? ORDER BY created_at ASC LIMIT ?',
      args: [userId, type, limit],
    });
    return result.rows;
  }
  const result = await db.execute({
    sql: 'SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at ASC LIMIT ?',
    args: [userId, limit],
  });
  return result.rows;
}

export async function addConversation(userId, userMessage, agentResponse, conversationType = 'training') {
  const db = await initDb();
  await db.execute({
    sql: 'INSERT INTO conversations (user_id, user_message, agent_response, conversation_type) VALUES (?, ?, ?, ?)',
    args: [userId, userMessage, agentResponse, conversationType],
  });
}

/* ── Transcripts (saved conversation snapshots) ───────────────────── */

export async function createTranscript(userId, name, transcriptType, messages) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO transcripts (user_id, name, transcript_type, messages) VALUES (?, ?, ?, ?)',
    args: [userId, name, transcriptType, JSON.stringify(messages)],
  });
  return Number(result.lastInsertRowid);
}

/** @param {'freestyle'|'training'} type */
export async function getTranscriptsByUserId(userId, type = null) {
  const db = await initDb();
  if (type) {
    const result = await db.execute({
      sql: 'SELECT id, user_id, name, transcript_type, created_at FROM transcripts WHERE user_id = ? AND transcript_type = ? ORDER BY created_at DESC',
      args: [userId, type],
    });
    return result.rows;
  }
  const result = await db.execute({
    sql: 'SELECT id, user_id, name, transcript_type, created_at FROM transcripts WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return result.rows;
}

export async function getTranscriptById(id, userId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM transcripts WHERE id = ? AND user_id = ?',
    args: [id, userId],
  });
  return result.rows[0] || null;
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

/* ── Playground functions ──────────────────────────────────────────── */

export async function getPlaygroundWorld() {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_world WHERE id = 1',
    args: [],
  });
  if (result.rows.length === 0) {
    // Initialize world if it doesn't exist
    const defaultConfig = {
      name: 'Stanford Campus',
      locations: [
        { name: 'Main Quad', x: 300, y: 200, description: 'Central gathering area' },
        { name: 'Green Library', x: 150, y: 100, description: 'Main library building' },
        { name: 'Tresidder Union', x: 450, y: 250, description: 'Student center with cafes' },
        { name: 'Memorial Church', x: 300, y: 150, description: 'Historic chapel' },
        { name: 'White Plaza', x: 350, y: 300, description: 'Outdoor plaza with tables' },
        { name: 'Gym', x: 500, y: 100, description: 'Athletic facilities' },
        { name: 'Coffee House', x: 400, y: 200, description: 'Popular cafe spot' },
      ],
      items: [
        { name: 'Bike Rack', location: 'Main Quad', x: 320, y: 220 },
        { name: 'Study Table', location: 'Green Library', x: 160, y: 110 },
        { name: 'Outdoor Seating', location: 'White Plaza', x: 360, y: 310 },
      ],
    };
    const defaultState = {
      agentPositions: {},
      activeConversations: [],
    };
    await db.execute({
      sql: 'INSERT INTO playground_world (id, world_name, world_config, current_state) VALUES (?, ?, ?, ?)',
      args: [
        1,
        'Stanford Campus',
        JSON.stringify(defaultConfig),
        JSON.stringify(defaultState),
      ],
    });
    return {
      id: 1,
      world_name: 'Stanford Campus',
      world_config: JSON.stringify(defaultConfig),
      current_state: JSON.stringify(defaultState),
      last_interaction_hour: null,
    };
  }
  return result.rows[0];
}

export async function updatePlaygroundWorld(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('updatePlaygroundWorld requires a data object');
  }
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
    }
  }
  if (fields.length === 0) {
    return; // Nothing to update
  }
  values.push(1);
  await db.execute({
    sql: `UPDATE playground_world SET ${fields.join(', ')}, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
    args: values,
  });
}

export async function getActivePlaygroundAgents() {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_agents WHERE status = ? ORDER BY created_at ASC',
    args: ['active'],
  });
  return result.rows;
}

export async function getPlaygroundAgentByUserId(userId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_agents WHERE user_id = ?',
    args: [userId],
  });
  return result.rows[0] || null;
}

export async function createPlaygroundAgent(userId, agentName, location = 'Main Quad') {
  const db = await initDb();
  const world = await getPlaygroundWorld();
  const config = JSON.parse(world.world_config);
  const locationData = config.locations.find((l) => l.name === location) || config.locations[0];
  
  const result = await db.execute({
    sql: 'INSERT INTO playground_agents (user_id, agent_name, position_x, position_y, current_location) VALUES (?, ?, ?, ?, ?)',
    args: [userId, agentName, locationData.x, locationData.y, location],
  });
  return Number(result.lastInsertRowid);
}

export async function updatePlaygroundAgent(userId, data) {
  if (!data || typeof data !== 'object') {
    throw new Error('updatePlaygroundAgent requires a data object');
  }
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) {
    return; // Nothing to update
  }
  values.push(userId);
  await db.execute({
    sql: `UPDATE playground_agents SET ${fields.join(', ')} WHERE user_id = ?`,
    args: values,
  });
}

export async function removePlaygroundAgent(userId) {
  const db = await initDb();
  await db.execute({
    sql: 'DELETE FROM playground_agents WHERE user_id = ?',
    args: [userId],
  });
}

export async function getInteractionForHour(userId, hour, date) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_interactions WHERE user_id = ? AND interaction_hour = ? AND interaction_date = ?',
    args: [userId, hour, date],
  });
  return result.rows[0] || null;
}

export async function createInteraction(userId, hour, date) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO playground_interactions (user_id, interaction_hour, interaction_date, started_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
    args: [userId, hour, date],
  });
  return Number(result.lastInsertRowid);
}

export async function updateInteraction(interactionId, data) {
  if (!data || typeof data !== 'object') {
    throw new Error('updateInteraction requires a data object');
  }
  const db = await initDb();
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (data.status === 'completed' && !data.completed_at) {
    fields.push('completed_at = CURRENT_TIMESTAMP');
  }
  if (fields.length === 0) {
    return; // Nothing to update
  }
  values.push(interactionId);
  await db.execute({
    sql: `UPDATE playground_interactions SET ${fields.join(', ')} WHERE id = ?`,
    args: values,
  });
}

export async function addPlaygroundTurn(interactionId, turnNumber, agentRole, otherAgentUserId, responseText, actionType, actionTarget, locationBefore, locationAfter) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'INSERT INTO playground_turns (interaction_id, turn_number, agent_role, other_agent_user_id, response_text, action_type, action_target, location_before, location_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    args: [interactionId, turnNumber, agentRole, otherAgentUserId, responseText, actionType, actionTarget, locationBefore, locationAfter],
  });
  return Number(result.lastInsertRowid);
}

export async function addPlaygroundConversation(interactionId, turnNumber, agentUserId, otherAgentUserId, message) {
  const db = await initDb();
  await db.execute({
    sql: 'INSERT INTO playground_conversations (interaction_id, turn_number, agent_user_id, other_agent_user_id, message) VALUES (?, ?, ?, ?, ?)',
    args: [interactionId, turnNumber, agentUserId, otherAgentUserId, message],
  });
}

export async function getInteractionsByUserId(userId, date = null) {
  const db = await initDb();
  if (date) {
    const result = await db.execute({
      sql: 'SELECT * FROM playground_interactions WHERE user_id = ? AND interaction_date = ? ORDER BY interaction_hour ASC',
      args: [userId, date],
    });
    return result.rows;
  }
  const result = await db.execute({
    sql: 'SELECT * FROM playground_interactions WHERE user_id = ? ORDER BY interaction_date DESC, interaction_hour DESC LIMIT 100',
    args: [userId],
  });
  return result.rows;
}

export async function getTurnsByInteractionId(interactionId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_turns WHERE interaction_id = ? ORDER BY turn_number ASC',
    args: [interactionId],
  });
  return result.rows;
}

export async function getConversationsByInteractionId(interactionId) {
  const db = await initDb();
  const result = await db.execute({
    sql: 'SELECT * FROM playground_conversations WHERE interaction_id = ? ORDER BY turn_number ASC',
    args: [interactionId],
  });
  return result.rows;
}
