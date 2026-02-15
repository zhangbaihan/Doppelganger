import {
  createTranscript,
  getTranscriptsByUserId,
  clearConversations,
} from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

function defaultTranscriptName(type) {
  const d = new Date();
  const label = type === 'freestyle' ? 'Conversation' : 'Training';
  return `${label} — ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export default apiHandler(async (req, res) => {
  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    const type = req.query.type;
    const list = await getTranscriptsByUserId(
      decoded.userId,
      type === 'freestyle' || type === 'training' ? type : null
    );
    return res.json({ transcripts: list });
  }

  if (req.method === 'POST') {
    const { messages, type: transcriptType, name } = req.body;
    if (!Array.isArray(messages) || !transcriptType) {
      return res.status(400).json({ error: 'Body must include messages (array) and type (freestyle|training).' });
    }
    if (transcriptType !== 'freestyle' && transcriptType !== 'training') {
      return res.status(400).json({ error: 'type must be freestyle or training.' });
    }
    const safeMessages = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string')
      .map((m) => ({ role: m.role, text: m.text }));
    if (safeMessages.length === 0) {
      return res.status(400).json({ error: 'No valid messages to save.' });
    }
    const displayName = typeof name === 'string' && name.trim() ? name.trim() : defaultTranscriptName(transcriptType);
    const id = await createTranscript(decoded.userId, displayName, transcriptType, safeMessages);
    // Clear live conversation rows so the chat viewer starts fresh
    await clearConversations(decoded.userId, transcriptType);
    return res.status(201).json({ id, name: displayName, type: transcriptType });
  }

  return res.status(405).json({ error: 'Method not allowed' });
});
