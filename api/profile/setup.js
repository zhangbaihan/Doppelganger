import { getUserById, updateUser, parseUser } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { bitName } = req.body;
  if (!bitName || !bitName.trim()) {
    return res.status(400).json({ error: 'Bit name is required' });
  }

  await updateUser(decoded.userId, { bit_name: bitName.trim() });
  const user = await getUserById(decoded.userId);
  res.json({ user: parseUser(user) });
});
