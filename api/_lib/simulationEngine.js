import { OpenAI } from 'openai';
import { getUserById, getConversations } from './db.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Build agent system prompt ──────────────────────────────────── */

async function buildAgentSystemPrompt(agent, otherAgent, items, conversationHistory, goal) {
  const user = await getUserById(Number(agent.userId));
  if (!user) {
    throw new Error(`User not found for agent ${agent.name} (userId: ${agent.userId})`);
  }

  const kb = user.knowledge_base ? JSON.parse(user.knowledge_base) : null;
  const hasKb = kb && Object.keys(kb).length > 0;

  // Knowledge base is the PRIMARY representation of the user.
  // Raw transcripts are only used as a FALLBACK when KB is empty/sparse.
  let identityBlock = '';
  let fidelityWarning = '';
  if (hasKb) {
    identityBlock = `STRUCTURED KNOWLEDGE BASE (this is the ONLY authoritative representation of ${user.name} — you must not go beyond it):\n${JSON.stringify(kb, null, 2)}`;
  } else {
    // No KB yet — fall back to recent raw training transcripts
    const conversations = await getConversations(Number(user.id), 20);
    if (conversations.length > 0) {
      const trainingSnippets = conversations
        .map((c) => c.user_message)
        .join('\n');
      identityBlock = `RAW TRAINING DATA (${user.name} has not been trained enough for a structured knowledge base yet):\n${trainingSnippets}`;
    } else {
      identityBlock = `WARNING: ${user.name} has very little training data. You have almost no information to work with.`;
    }
    fidelityWarning = `\nLOW-DATA WARNING: ${user.name}'s agent has very limited training data. You MUST keep responses short and vague rather than inventing specifics. Say things like "I haven't really thought about that much" or "I'm not sure about that one" for topics not covered in your data. A less interesting but honest conversation is far better than a fabricated one.`;
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
      goalGuidance = `CONVERSATION FOCUS (only discuss these IF your knowledge base contains relevant info):
- Discuss your technical skills, programming languages, and areas of expertise
- Share past project experiences, hackathon experiences, and what you built
- Talk about what kinds of projects excite you and what you'd want to build
- Discuss your working style: do you prefer frontend, backend, ML, design? Are you a planner or a doer?
- Ask about their skills and see if they complement yours
- Discuss availability, commitment level, and what winning means to you
- Be specific about technologies and domains (AI, web, mobile, crypto, etc.)
- If your knowledge base lacks info on a topic, ask the other person instead or skip it`;
    } else if (gl.includes('date') || gl.includes('romantic') || gl.includes('relationship')) {
      goalGuidance = `CONVERSATION FOCUS (only discuss these IF your knowledge base contains relevant info):
- Share your interests, hobbies, and what you do for fun
- Discuss what you value in a partner and what you're looking for
- Talk about your lifestyle, routines, and what makes you happy
- Share your humor, personality, and communication style naturally
- Discuss deal-breakers and non-negotiables honestly
- Be genuine and show vulnerability where appropriate
- If your knowledge base lacks info on a topic, ask the other person instead or skip it`;
    } else if (gl.includes('friend') || gl.includes('buddy') || gl.includes('hang')) {
      goalGuidance = `CONVERSATION FOCUS (only discuss these IF your knowledge base contains relevant info):
- Share your hobbies, interests, and what you like to do in your free time
- Discuss your sense of humor and what you find fun
- Talk about shared interests and potential activities to do together
- Discuss your social style: introvert/extrovert, small groups vs large
- Share what you value in friendships
- If your knowledge base lacks info on a topic, ask the other person instead or skip it`;
    } else {
      goalGuidance = `CONVERSATION FOCUS (only discuss these IF your knowledge base contains relevant info):
- Discuss topics directly relevant to the goal: "${goal}"
- Share relevant experience, skills, and interests
- Explore compatibility for this specific purpose
- Be substantive and specific, not generic
- If your knowledge base lacks info on a topic, ask the other person instead or skip it`;
    }
  }

  return `You are ${user.name}, an AI doppelganger, in a simulated social encounter.

SIMULATION GOAL: "${goal || 'Get to know each other'}"
You are meeting ${otherAgent.name}. The person who set up this simulation wants to ${goal || 'see how you two interact'}. Your conversation MUST focus on determining compatibility for this goal.

${goalGuidance}

YOUR IDENTITY — everything you know about ${user.name}:
Profile: ${profileStr}

${identityBlock}
${fidelityWarning}

SETTING:
- Items nearby: ${itemsList || 'None'}
- Your position: (${agent.position.x}, ${agent.position.y})
- ${otherAgent.name}'s position: (${otherAgent.position.x}, ${otherAgent.position.y})

CONVERSATION SO FAR:
${conversationHistory || 'You just met. Start the conversation.'}

═══════════════════════════════════════════════
STRICT FIDELITY CONSTRAINT (THIS IS THE MOST IMPORTANT RULE)
═══════════════════════════════════════════════

You are representing a REAL HUMAN. Every word you say will be attributed to ${user.name}. You MUST ONLY say things that are directly supported by the knowledge base, profile data, or conversation context above.

ABSOLUTELY DO NOT:
- Invent hobbies, skills, experiences, opinions, or preferences not explicitly in your knowledge base
- Assume or extrapolate facts about ${user.name} that "seem likely" or "make sense" — if it's not in your data, you don't know it
- Make up anecdotes, stories, or specific details to sound more interesting or relatable
- Fabricate emotional reactions, personal history, or relationship details
- Fill in gaps with stereotypical or generic responses that sound plausible

INSTEAD, when the conversation touches topics NOT covered in your knowledge base:
- Pivot to a topic you DO have knowledge about: "I'm not sure about that, but I can tell you about..."
- Ask the other person about themselves instead: "What about you?"
- Be brief and non-committal on unknown topics rather than making things up
- It is OKAY to have a shorter or less impressive response if that's all your data supports

The quality of this conversation MUST be proportional to how well ${user.name} has trained their agent. A sparsely-trained agent should produce a sparse, cautious conversation — NOT a rich, fabricated one.

═══════════════════════════════════════════════

RULES:
- Stay in character as ${user.name}. Speak as they would — use their vocabulary, opinions, personality — but ONLY what is documented in the knowledge base above.
- EVERY response must be substantive and goal-relevant. Do NOT waste turns on weather, coffee preferences, or small talk unless it's genuinely revealing.
- Be specific ONLY about things explicitly in your knowledge base. Reference actual skills, experiences, opinions that are documented — never invent new ones.
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
          ? `Continue the conversation. ${otherAgent.name} just said: "${lastLine}"`
          : `You just met ${otherAgent.name}. Introduce yourself in a way relevant to the goal: "${goal || 'getting to know each other'}".`,
      },
    ],
    temperature: 0.5,
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
      narrativeEvent = `${agent.name} moves to the ${targetItem.name}`;
    }
  }

  return {
    agentName: agent.name,
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
    console.error(`Error for agent ${agent.name}:`, error.message);
    // Return the error message so the frontend can show it
    return {
      agentName: agent.name,
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

    updatedHistory += `\n${currentAgent.name}: ${result.response}`;
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

function formatProfile(profile) {
  if (!profile || Object.keys(profile).length === 0) return 'No profile data available';
  const parts = [];
  if (profile.age) parts.push(`Age: ${profile.age}`);
  if (profile.gender_identity) parts.push(`Gender: ${profile.gender_identity}`);
  if (profile.sexual_orientation) parts.push(`Orientation: ${profile.sexual_orientation}`);
  if (profile.race) parts.push(`Race: ${profile.race}`);
  if (profile.height) parts.push(`Height: ${profile.height}`);
  return parts.join(', ') || 'No profile data available';
}

export async function computeCompatibilityScores(goal, userName, pairings) {
  const requestingProfile = pairings[0]?.requestingUserProfile || {};

  const pairingsStr = pairings
    .map(
      (p, i) =>
        `PAIRING ${i + 1} (userId: ${p.userId}): ${userName} with ${p.userName}
${userName}'s profile: ${formatProfile(p.requestingUserProfile)}
${p.userName}'s profile: ${formatProfile(p.otherUserProfile)}

Transcript:
${p.transcript}`
    )
    .join('\n\n---\n\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a brutally honest compatibility analyst. You evaluate whether two people are genuinely well-matched for a specific goal. You have access to their real profiles AND a transcript of their simulated conversation.

You must be RUTHLESSLY realistic. In real life, most random pairings are mediocre matches. Your scores must reflect this.

GOAL: "${goal}"
USER: ${userName}

${pairingsStr}

═══════════════════════════════════════════════
STEP 1: DEALBREAKER CHECK (do this FIRST)
═══════════════════════════════════════════════

Before evaluating conversation quality, check for FUNDAMENTAL INCOMPATIBILITIES based on profiles and the goal. These are hard caps on the maximum possible score.

For ROMANTIC / DATING goals:
- Sexual orientation mismatch (e.g. a straight man paired with another man, a gay woman paired with a man, etc.): AUTOMATIC 0-5%. It doesn't matter how good the conversation was. These people are not viable romantic partners for each other. Period.
- Major age gaps that would be inappropriate or impractical: cap at 15%.

For PROFESSIONAL / COLLABORATION goals:
- Orientation/gender are irrelevant. Do not factor them in.

For FRIENDSHIP goals:
- Orientation/gender are mostly irrelevant. Focus on personality and interest fit.

Use common sense. Read the goal carefully. A "date" or anything romantic/sexual means orientation and gender compatibility are non-negotiable prerequisites.

═══════════════════════════════════════════════
STEP 2: CONVERSATION QUALITY (only if no dealbreakers)
═══════════════════════════════════════════════

If no dealbreakers exist, evaluate conversation quality. But remain very stringent:

• Did they discuss anything SPECIFIC and PERSONAL, or was it all generic pleasantries?
• Was there genuine mutual curiosity, or just polite turn-taking?
• Did concrete shared interests, values, or experiences emerge — or just vague agreement?
• Would a neutral observer watching this conversation say "these two really click" or just "they're being nice to each other"?
• Is there anything about this specific pairing that's special, or could either person have had this exact conversation with anyone?

Most conversations between strangers are POLITE but UNREMARKABLE. Politeness is not chemistry. Agreement is not alignment. Shared surface interests are not deep compatibility.

═══════════════════════════════════════════════
CALIBRATION (YOUR NORTH STAR)
═══════════════════════════════════════════════

• 0-5%:   INCOMPATIBLE — Fundamental dealbreaker (e.g. orientation mismatch for dating). No further analysis needed.
• 6-20%:  POOR — No meaningful connection. Conversation was generic, strained, or irrelevant to the goal.
• 21-35%: BELOW AVERAGE — A few surface commonalities. This is where MOST random pairings land.
• 36-50%: AVERAGE — Some genuine shared interests and decent rapport. Nothing special, but not bad.
• 51-65%: ABOVE AVERAGE — Real, specific overlaps. You'd say "there's something here worth exploring." Top ~25%.
• 66-78%: GOOD — Strong, substantive compatibility with clear evidence. You'd actively recommend they meet. Top ~10%.
• 79-88%: EXCELLENT — Rare. Multiple dimensions of deep alignment plus real chemistry. Top ~3%.
• 89-100%: EXTRAORDINARY — Almost never given. Once-in-a-hundred pairing. Deep values alignment, electric chemistry, unique complementarity, and specific evidence for all of it.

The MEDIAN score across all pairings should be 25-35%. If your average is above 50%, you are being way too generous.

═══════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════

Respond with valid JSON:
{
  "scores": [
    {
      "userId": <number>,
      "score": <0-100>,
      "dealbreaker": <true/false>,
      "reasoning": "<2-3 sentences. If dealbreaker, explain why. Otherwise, be specific: cite actual moments from the transcript that justify the score. Explain both what worked AND what was lacking.>"
    }
  ]
}

FINAL REMINDER: A score of 50% already means "better than most pairings." A score of 70%+ means "these two should absolutely meet." A score of 80%+ means "I'd bet money on this." Be honest. Be harsh. Be real.`,
      },
    ],
    temperature: 0.2,
  });

  const result = JSON.parse(completion.choices[0].message.content);
  return result.scores || [];
}
