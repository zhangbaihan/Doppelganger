import {
  getPlaygroundAgentByUserId,
  getInteractionsByUserId,
  getTurnsByInteractionId,
  getConversationsByInteractionId,
  getUserById,
  parseUser,
  createPlaygroundAgent,
  getPlaygroundWorld,
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
    let agent = await getPlaygroundAgentByUserId(decoded.userId);
    
    // Auto-join if not in playground but has bit_name
    if (!agent) {
      const user = await getUserById(decoded.userId);
      if (user && user.bit_name) {
        try {
          const world = await getPlaygroundWorld();
          const worldConfig = JSON.parse(world.world_config);
          const startingLocation = worldConfig.locations[0].name;
          await createPlaygroundAgent(decoded.userId, user.bit_name, startingLocation);
          agent = await getPlaygroundAgentByUserId(decoded.userId);
        } catch (err) {
          console.error('Failed to auto-join playground:', err);
        }
      }
      if (!agent) {
        return res.json({ agent: null, interactions: [], message: 'Not in playground' });
      }
    }

    // Get today's interactions
    const today = new Date().toISOString().split('T')[0];
    const interactions = await getInteractionsByUserId(decoded.userId, today);

    // Enrich interactions with turns and conversations
    const enrichedInteractions = await Promise.all(
      interactions.map(async (interaction) => {
        const turns = await getTurnsByInteractionId(interaction.id);
        const conversations = await getConversationsByInteractionId(interaction.id);
        return {
          ...interaction,
          turns,
          conversations,
        };
      })
    );

    return res.json({
      agent,
      interactions: enrichedInteractions,
    });
  } catch (err) {
    console.error('My agent error:', err);
    return res.status(500).json({ error: 'Failed to load agent data' });
  }
});
