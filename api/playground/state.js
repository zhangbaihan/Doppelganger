import {
  getPlaygroundWorld,
  getActivePlaygroundAgents,
  getUserById,
  parseUser,
} from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const world = await getPlaygroundWorld();
    const agents = await getActivePlaygroundAgents();

    // Enrich agents with user data
    const enrichedAgents = await Promise.all(
      agents.map(async (agent) => {
        const user = await getUserById(agent.user_id);
        return {
          ...agent,
          user: user ? parseUser(user) : null,
        };
      })
    );

    return res.json({
      world: {
        ...world,
        world_config: JSON.parse(world.world_config),
        current_state: JSON.parse(world.current_state),
      },
      agents: enrichedAgents,
    });
  } catch (err) {
    console.error('Playground state error:', err);
    return res.status(500).json({ error: 'Failed to load playground state' });
  }
});
