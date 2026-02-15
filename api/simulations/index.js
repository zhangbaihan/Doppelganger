import {
  getSimulationsByUserId,
  createSimulation,
  addSimulationParticipant,
} from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  // GET: list simulations
  if (req.method === 'GET') {
    const simulations = await getSimulationsByUserId(decoded.userId);
    return res.json({ simulations });
  }

  // POST: create simulation
  if (req.method === 'POST') {
    const { name, items, participants, numSimulations } = req.body || {};

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    if (!participants || !Array.isArray(participants) || participants.length < 1) {
      return res.status(400).json({ error: 'At least one participant is required' });
    }
    if (!numSimulations || numSimulations < 1) {
      return res.status(400).json({ error: 'Number of simulations must be at least 1' });
    }

    const config = { items, participants };
    const simulationId = await createSimulation(
      decoded.userId,
      name || 'Untitled Simulation',
      config,
      numSimulations
    );

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      await addSimulationParticipant(
        simulationId,
        p.isRandom ? null : p.userId,
        !!p.isRandom,
        `agent${i + 1}`
      );
    }

    return res.json({ simulationId, message: 'Simulation created successfully' });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
