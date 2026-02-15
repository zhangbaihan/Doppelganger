import { processOneRound, computeCompatibilityScores } from '../_lib/simulationEngine.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.body || {};

  /* ── Step: process one round of conversation ────────────────── */
  if (action === 'step') {
    const { agents, items, conversationHistory, goal } = req.body;

    if (!agents || agents.length < 2) {
      return res.status(400).json({ error: 'Need at least 2 agents' });
    }

    // Ensure agents have mutable position objects
    const mutableAgents = agents.map((a) => ({
      ...a,
      position: { ...a.position },
    }));

    try {
      const result = await processOneRound(
        mutableAgents,
        items || [],
        conversationHistory || '',
        goal || ''
      );

      return res.json(result);
    } catch (err) {
      console.error('Step processing error:', err);
      return res.status(500).json({ error: err.message || 'Failed to process step' });
    }
  }

  /* ── Score: compute compatibility after simulation ──────────── */
  if (action === 'score') {
    const { goal, pairings, userName } = req.body;

    if (!goal || !pairings || pairings.length === 0) {
      return res.status(400).json({ error: 'Goal and pairings are required' });
    }

    const scores = await computeCompatibilityScores(goal, userName || 'User', pairings);

    // Merge names back into scores
    const enrichedScores = scores.map((s) => {
      const pairing = pairings.find((p) => p.userId === s.userId);
      return {
        ...s,
        userName: pairing?.userName || '',
        bitName: pairing?.bitName || '',
      };
    });

    return res.json({ scores: enrichedScores });
  }

  return res.status(400).json({ error: 'Invalid action. Use "step" or "score".' });
});
