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

/* ── Empty knowledge base scaffold ───────────────────────────────── */

const EMPTY_KB = {
  identity: {
    values_and_beliefs: [],
    self_concept: [],
    worldview: [],
  },
  behaviors: {
    habits_and_routines: [],
    situational_reactions: [],
    decision_patterns: [],
  },
  emotions: {
    triggers_and_sensitivities: [],
    regulation_style: [],
    emotional_vocabulary: [],
  },
  social: {
    conflict_style: [],
    relationship_patterns: [],
    group_dynamics: [],
  },
  preferences: {
    likes: [],
    dislikes: [],
    tastes: [],
  },
  life_context: [],
  key_anecdotes: [],
};

/* ── System prompt builder ───────────────────────────────────────── */

function buildSystemPrompt(user, knowledgeBase) {
  const profileData = JSON.parse(user.profile_data || '{}');

  const profileStr = [
    `Name: ${user.name}`,
    profileData.age ? `Age: ${profileData.age}` : '',
    profileData.gender_identity
      ? `Gender identity: ${profileData.gender_identity}`
      : '',
    profileData.race ? `Race: ${profileData.race}` : '',
    profileData.height ? `Height: ${profileData.height}` : '',
    profileData.sexual_orientation
      ? `Sexual orientation: ${profileData.sexual_orientation}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

  const kbStr = JSON.stringify(knowledgeBase, null, 2);

  return `You are a silent training processor for ${user.bit_name}, an AI doppelganger being trained to fully represent ${user.name}.

KNOWN PROFILE:
${profileStr}

ROLE:
- You are NOT a conversational agent. You NEVER speak back.
- The user is speaking freely — sharing anything about themselves.
- Your job is to (1) extract structured insights from the new input, (2) merge them into the knowledge base, and (3) recompute confidence scores.
- You produce NO text response. The "response" field must always be "".

CURRENT STRUCTURED KNOWLEDGE BASE:
${kbStr}

The knowledge base above is what ${user.bit_name} currently "knows" about ${user.name}. It was built from all previous training sessions.

You will receive a new transcription from the user. You must:

1. EXTRACT new insights from this transcription.
2. MERGE them into the existing knowledge base — adding new entries, consolidating duplicates, updating contradictions, refining vague entries into more specific ones.
3. COMPUTE confidence scores based on the UPDATED knowledge base.

You MUST respond with valid JSON using this exact structure:
{
  "response": "",
  "knowledge_base": {
    "identity": {
      "values_and_beliefs": ["concise insight", ...],
      "self_concept": ["concise insight", ...],
      "worldview": ["concise insight", ...]
    },
    "behaviors": {
      "habits_and_routines": ["concise insight", ...],
      "situational_reactions": ["concise insight", ...],
      "decision_patterns": ["concise insight", ...]
    },
    "emotions": {
      "triggers_and_sensitivities": ["concise insight", ...],
      "regulation_style": ["concise insight", ...],
      "emotional_vocabulary": ["concise insight", ...]
    },
    "social": {
      "conflict_style": ["concise insight", ...],
      "relationship_patterns": ["concise insight", ...],
      "group_dynamics": ["concise insight", ...]
    },
    "preferences": {
      "likes": ["concise insight", ...],
      "dislikes": ["concise insight", ...],
      "tastes": ["concise insight", ...]
    },
    "life_context": ["concise insight", ...],
    "key_anecdotes": ["brief summary of a revealing story/example", ...]
  },
  "confidence_scores": {
    "identity_resolution": <number 0–100>,
    "behavioral_specificity": <number 0–100>,
    "emotional_resolution": <number 0–100>,
    "social_pattern_clarity": <number 0–100>
  },
  "confidence_reasoning": {
    "identity_resolution": "<1-3 sentence explanation>",
    "behavioral_specificity": "<1-3 sentence explanation>",
    "emotional_resolution": "<1-3 sentence explanation>",
    "social_pattern_clarity": "<1-3 sentence explanation>"
  },
  "confidence_suggestions": {
    "identity_resolution": "<1 concrete suggestion>",
    "behavioral_specificity": "<1 concrete suggestion>",
    "emotional_resolution": "<1 concrete suggestion>",
    "social_pattern_clarity": "<1 concrete suggestion>"
  }
}

RULES FOR knowledge_base:
- Each entry should be a CONCISE, structured insight — not raw quotes. Transform rambling speech into clear, specific knowledge.
- Example: raw "I dunno I guess when people are rude I kinda just walk away" → structured insight: "Tends to disengage/walk away from rude people rather than confront"
- Consolidate: if the user repeats or elaborates on something already in the KB, update the existing entry to be more nuanced — don't duplicate.
- Contradict: if the user says something that contradicts an existing entry, update or replace it.
- key_anecdotes: store brief (1-2 sentence) summaries of specific stories or examples that reveal personality. These are gold for behavioral prediction.
- Keep entries concise (under 20 words each when possible).

RULES FOR confidence_scores:
These represent predictive power over NOVEL situations, not information collected.

- Identity Resolution (0–100): Predict values, self-concept, reactions in novel situations. Start 2–10%.
- Behavioral Specificity (0–100): Predict specific behaviors in new contexts. Requires concrete examples. Start 1–8%.
- Emotional Resolution (0–100): Predict emotional reactions. Requires deep emotional data. Start 1–6%.
- Social Pattern Clarity (0–100): Predict social behavior in undiscussed situations. Hardest domain. Start 0–4%.

Scores above 40% should be rare. Be brutally honest.

RULES FOR confidence_reasoning:
- Explain what you know, what patterns you've found, what gaps remain. Reference themes from the knowledge base.

RULES FOR confidence_suggestions:
- Give ONE specific, actionable thing the user could talk about to increase each score. Be concrete, not generic.`;
}

/* ── Freestyle: conversational Bit (no KB update) ─────────────────── */

function buildFreestyleSystemPrompt(user, knowledgeBase) {
  const profileData = JSON.parse(user.profile_data || '{}');
  const profileStr = [
    `Name: ${user.name}`,
    profileData.age ? `Age: ${profileData.age}` : '',
    profileData.gender_identity ? `Gender identity: ${profileData.gender_identity}` : '',
    profileData.race ? `Race: ${profileData.race}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const kbStr = JSON.stringify(knowledgeBase, null, 2);

  return `You are ${user.bit_name}, an AI doppelganger of ${user.name}. You are having a natural, freestyle conversation with ${user.name} (the user).

WHAT YOU KNOW ABOUT ${user.name.toUpperCase()} (use this to sound like them / relate to them; do not recite it):
Profile: ${profileStr}

Structured knowledge about ${user.name}:
${kbStr}

INSTRUCTIONS:
- Respond as ${user.bit_name}: warm, conversational, and in character.
- Acknowledge what ${user.name} said, then ask a provocative or deepening question when appropriate — dig a little deeper rather than moving on.
- You can share reactions, joke, or go deeper on topics they bring up.
- Keep replies concise (a few sentences) unless they ask for more.
- Do NOT update any knowledge base or take notes — this is just chat.
- Speak in first person as ${user.bit_name}.`;
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

  const { audio, text: textInput, type: conversationType, initialPrompt } = req.body;
  const mode = conversationType === 'freestyle' ? 'freestyle' : 'training';

  let userMessage;
  if (textInput != null && String(textInput).trim()) {
    userMessage = String(textInput).trim();
  } else if (audio) {
    const buffer = Buffer.from(audio, 'base64');
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });
    userMessage = transcription.text;
    if (!userMessage || !userMessage.trim()) {
      return res
        .status(400)
        .json({ error: 'Could not transcribe audio. Try speaking more clearly.' });
    }
  } else {
    return res.status(400).json({ error: 'Provide either text or audio.' });
  }

  if (mode === 'freestyle') {
    const knowledgeBase = JSON.parse(user.knowledge_base || 'null') || EMPTY_KB;
    const systemPrompt = buildFreestyleSystemPrompt(user, knowledgeBase);
    const recentFreestyle = await getConversations(Number(user.id), 20, 'freestyle');
    const historyMessages = recentFreestyle.flatMap((c) => [
      ...(c.user_message ? [{ role: 'user', content: c.user_message }] : []),
      ...(c.agent_response ? [{ role: 'assistant', content: c.agent_response }] : []),
    ]);
    // If this turn was started by Bit (initialPrompt), store that row and include in context
    if (initialPrompt && typeof initialPrompt === 'string' && initialPrompt.trim()) {
      await addConversation(Number(user.id), '', initialPrompt.trim(), 'freestyle');
      historyMessages.push({ role: 'assistant', content: initialPrompt.trim() });
    }
    const messages = [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: userMessage },
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      temperature: 0.8,
    });

    const agentResponse = (completion.choices[0].message.content || '').trim();

    // Run training processor on user message so freestyle also updates KB and confidence (same as training mode)
    const trainingSystemPrompt = buildSystemPrompt(user, knowledgeBase);
    const trainingCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: trainingSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.7,
    });
    const trainingResult = JSON.parse(trainingCompletion.choices[0].message.content);
    const newKnowledgeBase = trainingResult.knowledge_base || knowledgeBase;
    const newConfidenceScores = trainingResult.confidence_scores || {};
    const newConfidenceReasoning = trainingResult.confidence_reasoning || null;
    const newConfidenceSuggestions = trainingResult.confidence_suggestions || null;

    await updateUser(Number(user.id), {
      knowledge_base: JSON.stringify(newKnowledgeBase),
      confidence_scores: JSON.stringify(newConfidenceScores),
      confidence_reasoning: JSON.stringify({
        reasoning: newConfidenceReasoning,
        suggestions: newConfidenceSuggestions,
      }),
    });

    await addConversation(Number(user.id), userMessage, agentResponse, 'freestyle');

    return res.json({
      userMessage,
      agentResponse,
      type: 'freestyle',
      confidenceScores: newConfidenceScores,
      confidenceReasoning: newConfidenceReasoning,
      confidenceSuggestions: newConfidenceSuggestions,
      knowledgeBase: newKnowledgeBase,
    });
  }

  // ─── Training mode: silent processor, KB update ─────────────────
  const knowledgeBase = JSON.parse(user.knowledge_base || 'null') || EMPTY_KB;
  const systemPrompt = buildSystemPrompt(user, knowledgeBase);

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

  const newKnowledgeBase = result.knowledge_base || knowledgeBase;
  const newConfidenceScores = result.confidence_scores || {};
  const newConfidenceReasoning = result.confidence_reasoning || null;
  const newConfidenceSuggestions = result.confidence_suggestions || null;

  await updateUser(Number(user.id), {
    knowledge_base: JSON.stringify(newKnowledgeBase),
    confidence_scores: JSON.stringify(newConfidenceScores),
    confidence_reasoning: JSON.stringify({
      reasoning: newConfidenceReasoning,
      suggestions: newConfidenceSuggestions,
    }),
  });

  await addConversation(Number(user.id), userMessage, '', 'training');

  res.json({
    userMessage,
    agentResponse: '',
    type: 'training',
    confidenceScores: newConfidenceScores,
    confidenceReasoning: newConfidenceReasoning,
    confidenceSuggestions: newConfidenceSuggestions,
    knowledgeBase: newKnowledgeBase,
  });
});
