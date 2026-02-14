import { getUserById, parseUser } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const user = await getUserById(decoded.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  res.json({ user: parseUser(user) });
});
