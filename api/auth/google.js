import { OAuth2Client } from 'google-auth-library';
import { getUserByGoogleId, createUser, parseUser } from '../_lib/db.js';
import { signToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { credential } = req.body || {};
  if (!credential) {
    return res.status(400).json({ error: 'Missing credential' });
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    console.error('Google token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid Google credential' });
  }

  let user = await getUserByGoogleId(payload.sub);
  if (!user) {
    user = await createUser(payload.sub, payload.email, payload.name);
  }

  const token = signToken(Number(user.id));
  res.json({ token, user: parseUser(user) });
});
