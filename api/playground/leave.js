import { removePlaygroundAgent } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    await removePlaygroundAgent(decoded.userId);
    return res.json({ message: 'Left playground' });
  } catch (err) {
    console.error('Leave playground error:', err);
    return res.status(500).json({ error: 'Failed to leave playground' });
  }
});
