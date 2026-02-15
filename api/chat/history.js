import { getConversations } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const type = req.query.type; // 'freestyle' | 'training' | undefined (all)
  const conversations = await getConversations(
    decoded.userId,
    50,
    type === 'freestyle' || type === 'training' ? type : null
  );
  res.json({ conversations });
});
