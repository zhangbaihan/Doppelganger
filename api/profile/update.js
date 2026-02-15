import { getUserById, updateUser, parseUser } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { profileData, knowledgeBase, name } = req.body || {};

  const updates = {};

  if (name !== undefined) {
    updates.name = name;
    // Also update bit_name to match first name
    updates.bit_name = `${name.trim().split(/\s+/)[0]}'s Bit`;
  }

  if (profileData !== undefined) {
    updates.profile_data = JSON.stringify(profileData);
  }

  if (knowledgeBase !== undefined) {
    updates.knowledge_base = JSON.stringify(knowledgeBase);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'Nothing to update' });
  }

  await updateUser(decoded.userId, updates);
  const user = await getUserById(decoded.userId);
  res.json({ user: parseUser(user) });
});
