import { getTranscriptById } from '../../_lib/db.js';
import { verifyToken } from '../../_lib/auth.js';
import { apiHandler } from '../../_lib/handler.js';

export default apiHandler(async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const id = parseInt(req.query.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid transcript id' });

  const row = await getTranscriptById(id, decoded.userId);
  if (!row) return res.status(404).json({ error: 'Transcript not found' });

  const messages = JSON.parse(row.messages || '[]');
  return res.json({
    id: Number(row.id),
    name: row.name,
    type: row.transcript_type,
    created_at: row.created_at,
    messages,
  });
});
