import { OpenAI } from 'openai';
import { getUserById, getConversations } from './db.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Build agent system prompt ──────────────────────────────────── */

async function buildAgentSystemPrompt(agent, otherAgent, items, conversationHistory, goal) {
  const user = await getUserById(Number(agent.userId));
  if (!user) {
    throw new Error(`User not found for agent ${agent.bitName} (userId: ${agent.userId})`);
  }

  const kb = user.knowledge_base ? JSON.parse(user.knowledge_base) : null;
  const hasKb = kb && Object.keys(kb).length > 0;

  // Knowledge base is the PRIMARY representation of the user.
  // Raw transcripts are only used as a FALLBACK when KB is empty/sparse.
  let identityBlock = '';
  if (hasKb) {
    identityBlock = `STRUCTURED KNOWLEDGE BASE (this is the authoritative representation of ${user.name}):\n${JSON.stringify(kb, null, 2)}`;
  } else {
    // No KB yet — fall back to recent raw training transcripts
    const conversations = await getConversations(Number(user.id), 20);
    if (conversations.length > 0) {
      const trainingSnippets = conversations
        .map((c) => c.user_message)
        .join('\n');
      identityBlock = `RAW TRAINING DATA (${user.name} has not been trained enough for a structured knowledge base yet):\n${trainingSnippets}`;
    } else {
      identityBlock = `WARNING: ${user.name} has very little training data. Do your best with what you know from their profile.`;
    }
  }

  const profileData = user.profile_data ? JSON.parse(user.profile_data) : {};
  const profileStr = [
    `Name: ${user.name}`,
    profileData.age ? `Age: ${profileData.age}` : '',
    profileData.gender_identity ? `Gender: ${profileData.gender_identity}` : '',
    profileData.race ? `Race: ${profileData.race}` : '',
    profileData.height ? `Height: ${profileData.height}` : '',
    profileData.sexual_orientation ? `Orientation: ${profileData.sexual_orientation}` : '',
  ].filter(Boolean).join(', ');

  const itemsList = items
    .map((item) => `${item.name} at (${item.x}, ${item.y})`)
    .join(', ');

  // Build goal-specific guidance
  let goalGuidance = '';
  if (goal) {
    const gl = goal.toLowerCase();
    if (gl.includes('hackathon') || gl.includes('teammate') || gl.includes('partner') || gl.includes('collaborat')) {
      goalGuidance = `CONVERSATION FOCUS:
- Discuss your technical skills, programming languages, and areas of expertise
- Share past project experiences, hackathon experiences, and what you built
- Talk about what kinds of projects excite you and what you'd want to build
- Discuss your working style: do you prefer frontend, backend, ML, design? Are you a planner or a doer?
- Ask about their skills and see if they complement yours
- Discuss availability, commitment level, and what winning means to you
- Be specific about technologies and domains (AI, web, mobile, crypto, etc.)`;
    } else if (gl.includes('date') || gl.includes('romantic') || gl.includes('relationship')) {
      goalGuidance = `CONVERSATION FOCUS:
- Share your interests, hobbies, and what you do for fun
- Discuss what you value in a partner and what you're looking for
- Talk about your lifestyle, routines, and what makes you happy
- Share your humor, personality, and communication style naturally
- Discuss deal-breakers and non-negotiables honestly
- Be genuine and show vulnerability where appropriate`;
    } else if (gl.includes('friend') || gl.includes('buddy') || gl.includes('hang')) {
      goalGuidance = `CONVERSATION FOCUS:
- Share your hobbies, interests, and what you like to do in your free time
- Discuss your sense of humor and what you find fun
- Talk about shared interests and potential activities to do together
- Discuss your social style: introvert/extrovert, small groups vs large
- Share what you value in friendships`;
    } else {
      goalGuidance = `CONVERSATION FOCUS:
- Discuss topics directly relevant to the goal: "${goal}"
- Share relevant experience, skills, and interests
- Explore compatibility for this specific purpose
- Be substantive and specific, not generic`;
    }
  }

  return `You are ${agent.bitName}, an AI doppelganger of ${user.name}, in a simulated social encounter.

SIMULATION GOAL: "${goal || 'Get to know each other'}"
You are meeting ${otherAgent.bitName} (representing ${otherAgent.name}). The person who set up this simulation wants to ${goal || 'see how you two interact'}. Your conversation MUST focus on determining compatibility for this goal.

${goalGuidance}

YOUR IDENTITY — everything you know about ${user.name}:
Profile: ${profileStr}

${identityBlock}

SETTING:
- Items nearby: ${itemsList || 'None'}
- Your position: (${agent.position.x}, ${agent.position.y})
- ${otherAgent.bitName}'s position: (${otherAgent.position.x}, ${otherAgent.position.y})

CONVERSATION SO FAR:
${conversationHistory || 'You just met. Start the conversation.'}

RULES:
- Stay in character as ${user.name}. Speak as they would — use their vocabulary, opinions, personality.
- EVERY response must be substantive and goal-relevant. Do NOT waste turns on weather, coffee preferences, or small talk unless it's genuinely revealing.
- Be specific. Reference actual skills, experiences, opinions from your knowledge base.
- Ask the other person meaningful questions that help assess compatibility for the goal.
- Keep responses concise (2-4 sentences). This is a conversation, not a monologue.
- You can suggest moving to an item in the world if it fits naturally.

Respond with valid JSON:
{
  "response": "Your conversational text",
  "action": {
    "type": "move" | "none",
    "target": "item name or null",
    "reasoning": "Brief explanation"
  }
}`;
}

/* ── Process one agent turn ──────────────────────────────────────── */

async function processAgentTurn(agent, otherAgent, items, conversationHistory, goal) {
  // Let errors propagate — don't swallow them
  const systemPrompt = await buildAgentSystemPrompt(agent, otherAgent, items, conversationHistory, goal);

  const lastLine = conversationHistory.split('\n').filter(Boolean).pop();
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: lastLine
          ? `Continue the conversation. ${otherAgent.bitName} just said: "${lastLine}"`
          : `You just met ${otherAgent.bitName}. Introduce yourself in a way relevant to the goal: "${goal || 'getting to know each other'}".`,
      },
    ],
    temperature: 0.75,
  });

  const result = JSON.parse(completion.choices[0].message.content);
  const response = result.response || '...';
  const action = result.action || { type: 'none', target: null, reasoning: '' };

  let narrativeEvent = null;
  if (action.type === 'move' && action.target) {
    const targetItem = items.find(
      (item) => item.name.toLowerCase() === action.target.toLowerCase()
    );
    if (targetItem) {
      const offset = agent.role === 'agent1' ? -15 : 15;
      agent.position = {
        x: targetItem.x + offset,
        y: targetItem.y + offset,
      };
      narrativeEvent = `${agent.bitName} moves to the ${targetItem.name}`;
    }
  }

  return {
    agentName: agent.bitName,
    response,
    action,
    narrativeEvent,
  };
}

/* ── Process one agent turn with error details ───────────────────── */

async function processAgentTurnSafe(agent, otherAgent, items, conversationHistory, goal) {
  try {
    return await processAgentTurn(agent, otherAgent, items, conversationHistory, goal);
  } catch (error) {
    console.error(`Error for agent ${agent.bitName}:`, error.message);
    // Return the error message so the frontend can show it
    return {
      agentName: agent.bitName,
      response: null,
      error: error.message,
      action: { type: 'none', target: null, reasoning: '' },
      narrativeEvent: null,
    };
  }
}

/* ── Process one round (all agents take a turn) ─────────────────── */

export async function processOneRound(agents, items, conversationHistory, goal) {
  const turnResults = [];
  let updatedHistory = conversationHistory;
  let done = false;
  let hasError = false;

  for (let i = 0; i < agents.length; i++) {
    const currentAgent = agents[i];
    const otherAgent = agents.find((a) => a.role !== currentAgent.role) || agents[(i + 1) % agents.length];

    const result = await processAgentTurnSafe(currentAgent, otherAgent, items, updatedHistory, goal);

    if (result.error) {
      hasError = true;
      turnResults.push(result);
      done = true;
      break;
    }

    updatedHistory += `\n${currentAgent.bitName}: ${result.response}`;
    if (result.narrativeEvent) {
      updatedHistory += `\n[${result.narrativeEvent}]`;
    }

    turnResults.push(result);

    if (
      result.response.toLowerCase().includes('goodbye') ||
      result.response.toLowerCase().includes('see you later') ||
      result.response.toLowerCase().includes('nice meeting you')
    ) {
      done = true;
      break;
    }
  }

  const agentPositions = {};
  for (const agent of agents) {
    agentPositions[agent.role] = agent.position;
  }

  return {
    turnResults,
    agentPositions,
    conversationHistory: updatedHistory,
    done,
    error: hasError ? turnResults.find((t) => t.error)?.error : undefined,
  };
}

/* ── Compute compatibility scores ────────────────────────────────── */

export async function computeCompatibilityScores(goal, userName, pairings) {
  const pairingsStr = pairings
    .map(
      (p, i) =>
        `PAIRING ${i + 1}: ${userName} with ${p.bitName} (${p.userName})\nTranscript:\n${p.transcript}`
    )
    .join('\n\n---\n\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You evaluate compatibility between people based on a simulated conversation between their AI agents.

GOAL: ${goal}

USER: ${userName}

${pairingsStr}

For each pairing, evaluate how well the OTHER person matches what ${userName} is looking for given the goal "${goal}".

Consider: conversation flow, shared interests, chemistry, mutual engagement, alignment with the stated goal.

Respond with valid JSON:
{
  "scores": [
    {
      "userId": <number>,
      "score": <0-100>,
      "reasoning": "<1-2 sentence explanation>"
    }
  ]
}

Be honest and differentiate. Not everyone is a good match. Scores should vary meaningfully.`,
      },
    ],
    temperature: 0.5,
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result.scores || [];
}
