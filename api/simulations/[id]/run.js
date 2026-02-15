import {
  getSimulation,
  updateSimulation,
  createSimulationRun,
} from '../../_lib/db.js';
import { verifyToken } from '../../_lib/auth.js';
import { apiHandler } from '../../_lib/handler.js';
import { runSimulation } from '../../_lib/simulationEngine.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const simulationId = parseInt(req.query.id);
  const simulation = await getSimulation(simulationId);

  if (!simulation || Number(simulation.user_id) !== decoded.userId) {
    return res.status(404).json({ error: 'Simulation not found' });
  }

  if (simulation.status === 'running') {
    return res.status(400).json({ error: 'Simulation is already running' });
  }

  const config = JSON.parse(simulation.config);
  const numSims = Number(simulation.num_simulations);
  await updateSimulation(simulationId, { status: 'running', current_sim_index: 0 });

  // Create simulation runs
  for (let i = 0; i < numSims; i++) {
    await createSimulationRun(simulationId, i);
  }

  // Run simulations synchronously (serverless — can't background)
  try {
    for (let i = 0; i < numSims; i++) {
      await updateSimulation(simulationId, { current_sim_index: i });
      await runSimulation(simulationId, i, config);
    }
    await updateSimulation(simulationId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    res.json({ message: 'Simulation completed', simulationId });
  } catch (error) {
    console.error('Simulation run error:', error);
    await updateSimulation(simulationId, { status: 'failed' });
    res.status(500).json({ error: 'Simulation failed: ' + error.message });
  }
});
