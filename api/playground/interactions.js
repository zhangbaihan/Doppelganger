import {
  getInteractionsByUserId,
  getTurnsByInteractionId,
  getConversationsByInteractionId,
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
    const { date, interactionId } = req.query;

    if (interactionId) {
      // Get specific interaction details
      const turns = await getTurnsByInteractionId(Number(interactionId));
      const conversations = await getConversationsByInteractionId(Number(interactionId));
      return res.json({ turns, conversations });
    }

    // Get interactions for date or all recent
    const interactions = await getInteractionsByUserId(decoded.userId, date || null);

    // Enrich with turns and conversations
    const enriched = await Promise.all(
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

    return res.json({ interactions: enriched });
  } catch (err) {
    console.error('Interactions error:', err);
    return res.status(500).json({ error: 'Failed to load interactions' });
  }
});
