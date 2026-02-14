import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'doppelganger-secret';

export function verifyToken(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.split(' ')[1];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}
