import {
  getSimulation,
  getSimulationRuns,
  getSimulationStates,
} from '../../../_lib/db.js';
import { verifyToken } from '../../../_lib/auth.js';
import { apiHandler } from '../../../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const simulationId = parseInt(req.query.id);
  const runIndex = parseInt(req.query.runIndex);

  const simulation = await getSimulation(simulationId);
  if (!simulation || Number(simulation.user_id) !== decoded.userId) {
    return res.status(404).json({ error: 'Simulation not found' });
  }

  const runs = await getSimulationRuns(simulationId);
  const run = runs.find((r) => Number(r.run_index) === runIndex);
  if (!run) {
    return res.status(404).json({ error: 'Simulation run not found' });
  }

  const states = await getSimulationStates(Number(run.id));
  const parsedStates = states.map((s) => ({
    stateIndex: Number(s.state_index),
    agentPositions: JSON.parse(s.agent_positions),
    transcript: s.transcript,
    items: s.items ? JSON.parse(s.items) : [],
    narrativeEvents: s.narrative_events ? JSON.parse(s.narrative_events) : [],
    timestamp: Number(s.timestamp),
  }));

  res.json({ states: parsedStates, run });
});
