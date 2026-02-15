import { getSimulation, getSimulationRuns } from '../../_lib/db.js';
import { verifyToken } from '../../_lib/auth.js';
import { apiHandler } from '../../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const simulationId = parseInt(req.query.id);
  const simulation = await getSimulation(simulationId);

  if (!simulation || Number(simulation.user_id) !== decoded.userId) {
    return res.status(404).json({ error: 'Simulation not found' });
  }

  const runs = await getSimulationRuns(simulationId);
  const completedRuns = runs.filter((r) => r.status === 'completed').length;
  const numSims = Number(simulation.num_simulations);

  res.json({
    status: simulation.status,
    currentSimIndex: Number(simulation.current_sim_index),
    numSimulations: numSims,
    completedRuns,
    progress: numSims > 0 ? (completedRuns / numSims) * 100 : 0,
  });
});
