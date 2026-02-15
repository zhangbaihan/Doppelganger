import {
  getPlaygroundAgentByUserId,
  createPlaygroundAgent,
  getPlaygroundWorld,
  getUserById,
  parseUser,
} from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserById(decoded.userId);
    if (!user || !user.bit_name) {
      return res.status(400).json({ error: 'User must have a bit_name' });
    }

    // Check if already in playground
    const existing = await getPlaygroundAgentByUserId(decoded.userId);
    if (existing) {
      return res.json({ message: 'Already in playground', agent: existing });
    }

    // Get world to find starting location
    const world = await getPlaygroundWorld();
    const worldConfig = JSON.parse(world.world_config);
    const startingLocation = worldConfig.locations[0].name; // Main Quad

    // Create agent
    const agentId = await createPlaygroundAgent(
      decoded.userId,
      user.bit_name,
      startingLocation
    );

    const agent = await getPlaygroundAgentByUserId(decoded.userId);

    return res.json({ message: 'Joined playground', agent });
  } catch (err) {
    console.error('Join playground error:', err);
    return res.status(500).json({ error: 'Failed to join playground' });
  }
});
