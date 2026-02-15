import {
  getSimulation,
  getSimulationParticipants,
  getSimulationRuns,
  deleteSimulation,
} from '../../_lib/db.js';
import { verifyToken } from '../../_lib/auth.js';
import { apiHandler } from '../../_lib/handler.js';

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const simulationId = parseInt(req.query.id);
  const simulation = await getSimulation(simulationId);

  if (!simulation || Number(simulation.user_id) !== decoded.userId) {
    return res.status(404).json({ error: 'Simulation not found' });
  }

  if (req.method === 'GET') {
    const participants = await getSimulationParticipants(simulationId);
    const runs = await getSimulationRuns(simulationId);

    return res.json({
      simulation: {
        ...simulation,
        config: JSON.parse(simulation.config),
      },
      participants,
      runs,
    });
  }

  if (req.method === 'DELETE') {
    await deleteSimulation(simulationId);
    return res.json({ message: 'Simulation deleted successfully' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
