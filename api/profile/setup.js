import { getUserById, updateUser, parseUser } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { bitName, realName, age, genderIdentity, race, height, sexualOrientation } =
    req.body || {};

  if (!bitName || !bitName.trim()) {
    return res.status(400).json({ error: 'Bit name is required' });
  }
  if (!realName || !realName.trim()) {
    return res.status(400).json({ error: 'Real name is required' });
  }

  const profileData = JSON.stringify({
    age: age || '',
    gender_identity: genderIdentity || '',
    race: race || '',
    height: height || '',
    sexual_orientation: sexualOrientation || '',
  });

  await updateUser(decoded.userId, {
    bit_name: bitName.trim(),
    name: realName.trim(),
    profile_data: profileData,
  });

  const user = await getUserById(decoded.userId);
  res.json({ user: parseUser(user) });
});
