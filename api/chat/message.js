import OpenAI, { toFile } from 'openai';
import {
  getUserById,
  updateUser,
  getConversations,
  addConversation,
} from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Initial training questions ──────────────────────────────────── */

const INITIAL_QUESTIONS = [
  "What's your age?",
  'How do you identify in terms of gender?',
  "Describe yourself however you'd like!",
  'Walk me through a recent day that felt like a good day.',
  "What do you usually do when you enter a room where you don't know anyone?",
  'What kinds of conversations make you lose track of time?',
  'What do you enjoy doing when you have nothing scheduled?',
  "Tell me about something you've changed your mind about in the past few years.",
  'What tends to annoy you more than it probably should?',
  'How do you usually show someone you appreciate them?',
  'Are there things that people often misunderstand about you?',
  'When you feel stressed, what do you typically do?',
  'What makes you feel most energized?',
  'What makes you feel drained?',
  "What's a small thing that reliably makes your day better?",
];

/* ── System prompt builder ───────────────────────────────────────── */

function buildSystemPrompt(user, questionsCovered, confidenceScores, history) {
  const historyStr = history
    .map((c) => `User: ${c.user_message}\n${user.bit_name}: ${c.agent_response}`)
    .join('\n\n');

  const questionsStr = INITIAL_QUESTIONS.map(
    (q, i) => `${i}: ${q}${questionsCovered.includes(i) ? ' [COVERED]' : ''}`
  ).join('\n');

  return `You are ${user.bit_name}, an AI agent being trained to be ${user.name}'s digital doppelganger. Your job is to learn everything about ${user.name} so you can eventually represent them accurately.

RULES:
- Respond ONLY in text. You never speak aloud.
- Be warm, curious, and encouraging — but concise.
- Show you are actively learning and remembering what the user tells you.
- Reference things the user said before to demonstrate memory.
- Ask follow-up questions sparingly — the user is here to tell you about themselves.

${historyStr ? `FULL CONVERSATION HISTORY:\n${historyStr}\n` : ''}

You MUST respond with valid JSON using this exact structure:
{
  "response": "Your natural, conversational text response.",
  "questions_covered": [array of integer indices 0–14 for all initial training questions adequately covered across ALL conversations so far],
  "confidence_scores": {
    "identity_resolution": <number 0–100>,
    "behavioral_specificity": <number 0–100>,
    "emotional_resolution": <number 0–100>,
    "social_pattern_clarity": <number 0–100>
  }
}

INITIAL TRAINING QUESTIONS (indices 0–14):
${questionsStr}

RULES FOR questions_covered:
- Include ALL questions adequately addressed across the ENTIRE conversation history, not just this message.
- A question is "covered" only if the user has genuinely, substantively addressed its topic — not merely mentioned it in passing.
- Previously covered questions (marked [COVERED]) must remain in the array unless the user explicitly contradicts or retracts their answer.

RULES FOR confidence_scores — READ CAREFULLY:
These scores represent your confidence at PREDICTING what ${user.name} would do, say, think, or feel in situations you have NOT explicitly discussed. This is about predictive power over novel situations, not how much information you have collected.

- Identity Resolution (0–100): Can you predict their values, self-concept, and reactions in novel situations? After basic demographics and a self-description, this should still be very low (5–15%) because knowing someone's age and gender gives nearly zero predictive power about their identity.

- Behavioral Specificity (0–100): Do you have enough concrete, situational examples to predict SPECIFIC behaviors in new contexts? Vague statements like "I'm chill" contribute almost nothing. Only detailed stories with actions and reactions meaningfully move this score. Start extremely low (2–10%).

- Emotional Resolution (0–100): Can you predict emotional reactions to novel situations? Do you understand their emotional vocabulary, regulation style, and triggers? This requires deep emotional data. Start very low (2–8%).

- Social Pattern Clarity (0–100): Can you predict how they would handle social situations you have not discussed — conflict style, intimacy patterns, group dynamics? This is the hardest domain to predict. Start extremely low (1–5%).

After initial training (all 15 questions covered), typical total scores should be in the 5–25% range per domain. Scores above 50% should be rare and require extensive, detailed training data across many sessions. Do NOT inflate scores to encourage the user — be brutally honest about your predictive limitations.`;
}

/* ── Handler ─────────────────────────────────────────────────────── */

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const user = await getUserById(decoded.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const { audio } = req.body;
  if (!audio) return res.status(400).json({ error: 'No audio data' });

  // Decode base64 → buffer → file for Whisper
  const buffer = Buffer.from(audio, 'base64');
  const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });

  const transcription = await openai.audio.transcriptions.create({
    model: 'whisper-1',
    file,
  });

  const userMessage = transcription.text;
  if (!userMessage || !userMessage.trim()) {
    return res.status(400).json({ error: 'Could not transcribe audio. Try speaking more clearly.' });
  }

  // Gather context
  const history = await getConversations(Number(user.id));
  const questionsCovered = JSON.parse(user.questions_covered || '[]');
  const confidenceScores = JSON.parse(user.confidence_scores || '{}');

  // Build prompt & call GPT-4o
  const systemPrompt = buildSystemPrompt(user, questionsCovered, confidenceScores, history);

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.7,
  });

  const result = JSON.parse(completion.choices[0].message.content);

  // Merge & persist
  const newQuestionsCovered = result.questions_covered || questionsCovered;
  const newConfidenceScores = result.confidence_scores || confidenceScores;
  const isTrained = newQuestionsCovered.length >= INITIAL_QUESTIONS.length;

  await updateUser(Number(user.id), {
    questions_covered: JSON.stringify(newQuestionsCovered),
    confidence_scores: JSON.stringify(newConfidenceScores),
    is_trained: isTrained ? 1 : 0,
  });

  await addConversation(Number(user.id), userMessage, result.response);

  res.json({
    userMessage,
    agentResponse: result.response,
    questionsCovered: newQuestionsCovered,
    confidenceScores: newConfidenceScores,
    isTrained,
  });
});
