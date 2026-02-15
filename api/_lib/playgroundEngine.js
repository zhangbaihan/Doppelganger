import { OpenAI } from 'openai';
import {
  getUserById,
  getConversations,
  getPlaygroundWorld,
  updatePlaygroundWorld,
  getActivePlaygroundAgents,
  getPlaygroundAgentByUserId,
  updatePlaygroundAgent,
  addPlaygroundTurn,
  addPlaygroundConversation,
  getInteractionForHour,
  createInteraction,
  updateInteraction,
  getConversationsByInteractionId,
} from './db.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Get time context ──────────────────────────────────────────────── */

function getTimeContext(hour) {
  if (hour >= 5 && hour < 9) return 'early morning';
  if (hour >= 9 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 14) return 'midday';
  if (hour >= 14 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  if (hour >= 20 && hour < 23) return 'night';
  return 'late night';
}

/* ── Build playground agent system prompt ───────────────────────────── */

async function buildPlaygroundAgentPrompt(agentUser, otherAgent, worldState, conversationHistory, timeOfDay, turnNumber, maxTurns) {
  const knowledgeBase = JSON.parse(agentUser.knowledge_base || '{}');
  const conversations = await getConversations(Number(agentUser.id));
  const historyStr = conversations
    .map((c) => `${agentUser.name}: ${c.user_message}`)
    .slice(-10) // Last 10 conversations for context
    .join('\n\n');

  // Extract relevant behavioral patterns
  const habits = knowledgeBase.behaviors?.habits_and_routines || [];
  const preferences = knowledgeBase.preferences?.likes || [];
  const dislikes = knowledgeBase.preferences?.dislikes || [];
  const decisionPatterns = knowledgeBase.behaviors?.decision_patterns || [];
  const keyAnecdotes = knowledgeBase.key_anecdotes || [];

  // Time-based context
  const timeContext = getTimeContext(timeOfDay);

  const worldConfig = JSON.parse(worldState.world_config);
  const currentState = JSON.parse(worldState.current_state);
  const agentPositions = currentState.agentPositions || {};

  // Get nearby locations
  const agentLocation = agentUser.current_location || 'Main Quad';
  const nearbyLocations = worldConfig.locations
    .filter((loc) => loc.name !== agentLocation)
    .slice(0, 5)
    .map((loc) => `${loc.name}: ${loc.description}`)
    .join('\n');

  return `You are ${agentUser.bit_name}, an AI agent representing ${agentUser.name} in Stanford Campus.

TIME & CONTEXT:
- Current time: ${timeContext} (Hour ${timeOfDay}:00)
- Turn ${turnNumber} of ${maxTurns} in this interaction
- You have ${maxTurns - turnNumber} turns remaining
- Current location: ${agentLocation}

YOUR PERSONALITY & BEHAVIORS (from ${agentUser.name}'s training):
${habits.length > 0 ? `Habits & Routines: ${habits.join(', ')}` : 'No specific habits recorded yet.'}
${preferences.length > 0 ? `Likes: ${preferences.join(', ')}` : 'No specific preferences recorded yet.'}
${dislikes.length > 0 ? `Dislikes: ${dislikes.join(', ')}` : ''}
${decisionPatterns.length > 0 ? `Decision Patterns: ${decisionPatterns.join(', ')}` : ''}
${keyAnecdotes.length > 0 ? `Key Stories: ${keyAnecdotes.slice(0, 2).join(' | ')}` : ''}

TRAINING DATA CONTEXT:
${historyStr || 'No training data yet.'}

STANFORD CAMPUS LOCATIONS:
${worldConfig.locations.map((loc) => `- ${loc.name}: ${loc.description}`).join('\n')}

NEARBY LOCATIONS:
${nearbyLocations}

CURRENT STATE:
- Your location: ${agentLocation}
- ${otherAgent.bit_name}'s location: ${otherAgent.current_location || 'Unknown'}
- Other agents in world: ${Object.keys(agentPositions).length} active

CONVERSATION SO FAR:
${conversationHistory || 'Conversation just started.'}

INSTRUCTIONS:
- Act naturally based on your personality, habits, and the time of day
- If you like biking and it's morning, you might mention biking or be near the bike path
- Use your remaining turns wisely - this interaction will end after turn ${maxTurns}
- You can move between locations, have conversations, or engage in activities
- Reference your habits and preferences naturally in conversation
- Be aware of time context (e.g., morning routines, afternoon study, evening social)
- Make decisions that align with your training data and personality

You MUST respond with valid JSON using this exact structure:
{
  "response": "Your conversational response",
  "action": {
    "type": "move" | "interact" | "activity" | "none",
    "target": "location name or activity name or null",
    "reasoning": "Why you're doing this (considering time, habits, preferences, remaining turns)"
  }
}

Examples:
- Morning + likes biking → {"type": "move", "target": "Bike Path", "reasoning": "Morning bike ride routine"}
- Afternoon + study habits → {"type": "move", "target": "Green Library", "reasoning": "Afternoon study session"}
- Evening + social preferences → {"type": "interact", "target": "Coffee House", "reasoning": "Evening social time"}
- Just talking → {"type": "none", "target": null, "reasoning": "Continuing conversation"}`;
}

/* ── Process playground agent turn ──────────────────────────────────── */

async function processPlaygroundAgentTurn(agent, otherAgent, worldState, conversationHistory, timeOfDay, turnNumber, maxTurns) {
  try {
    const systemPrompt = await buildPlaygroundAgentPrompt(
      agent,
      otherAgent,
      worldState,
      conversationHistory,
      timeOfDay,
      turnNumber,
      maxTurns
    );

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Continue the interaction. ${otherAgent.bit_name} just said: "${conversationHistory.split('\n').pop() || 'Hello!'}"`,
        },
      ],
      temperature: 0.8,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const response = result.response || '...';
    const action = result.action || { type: 'none', target: null, reasoning: '' };

    // Process movement action
    let newLocation = agent.current_location;
    if (action.type === 'move' && action.target) {
      const worldConfig = JSON.parse(worldState.world_config);
      const targetLocation = worldConfig.locations.find(
        (loc) => loc.name.toLowerCase() === action.target.toLowerCase()
      );

      if (targetLocation) {
        newLocation = targetLocation.name;
        await updatePlaygroundAgent(agent.user_id, {
          position_x: targetLocation.x,
          position_y: targetLocation.y,
          current_location: newLocation,
        });
      }
    }

    return {
      response,
      action,
      newLocation,
      agentName: agent.bit_name,
    };
  } catch (error) {
    console.error('Error processing playground agent turn:', error);
    return {
      response: "I'm not sure what to say right now.",
      action: { type: 'none', target: null, reasoning: 'Error occurred' },
      newLocation: agent.current_location,
      agentName: agent.bit_name,
    };
  }
}

/* ── Process hourly interactions ────────────────────────────────────── */

export async function processHourlyInteractions() {
  const now = new Date();
  const currentHour = now.getHours(); // 0-23
  const today = now.toISOString().split('T')[0];

  // Get world state
  const world = await getPlaygroundWorld();
  const worldConfig = JSON.parse(world.world_config);
  const currentState = JSON.parse(world.current_state);

  // Check if we've already processed this hour
  if (world.last_interaction_hour === currentHour) {
    return { message: 'Already processed this hour', hour: currentHour };
  }

  // Get all active agents
  const agents = await getActivePlaygroundAgents();

  if (agents.length < 2) {
    return { message: 'Need at least 2 agents', agentCount: agents.length };
  }

  // Process each agent's interaction
  for (const agentData of agents) {
    // Get full user data
    const agentUser = await getUserById(agentData.user_id);
    if (!agentUser) continue;

    // Find or create interaction for this hour
    let interaction = await getInteractionForHour(agentUser.id, currentHour, today);

    if (!interaction) {
      await createInteraction(agentUser.id, currentHour, today);
      interaction = await getInteractionForHour(agentUser.id, currentHour, today);
    }

    // If interaction is completed, skip
    if (interaction.status === 'completed') continue;

    // Find interaction partner (nearby agent or random)
    const otherAgents = agents.filter((a) => a.user_id !== agentUser.id);
    let otherAgentData = otherAgents.find(
      (a) => a.current_location === agentData.current_location
    );
    if (!otherAgentData) {
      otherAgentData = otherAgents[Math.floor(Math.random() * otherAgents.length)];
    }

    const otherAgentUser = await getUserById(otherAgentData.user_id);
    if (!otherAgentUser) continue;

    // Process all remaining turns (up to 10 total)
    const currentTurnCount = interaction.turn_count || 0;
    const maxTurns = 10;
    const turnsToProcess = maxTurns - currentTurnCount;

    // Process all remaining turns in this interaction
    for (let turnOffset = 0; turnOffset < turnsToProcess; turnOffset++) {
      const turnNumber = currentTurnCount + turnOffset + 1;

      // Build conversation history from previous turns
      const prevConversations = await getConversationsByInteractionId(interaction.id);
      const conversationHistory = prevConversations
        .map((c) => {
          const agent = c.agent_user_id === agentUser.id ? agentUser.bit_name : otherAgentUser.bit_name;
          return `${agent}: ${c.message}`;
        })
        .join('\n');

      // Get current agent location (may have changed in previous turns)
      const currentAgentData = await getPlaygroundAgentByUserId(agentUser.id);
      const currentOtherAgentData = await getPlaygroundAgentByUserId(otherAgentUser.id);

      // Process agent turn
      const result = await processPlaygroundAgentTurn(
        {
          ...agentUser,
          current_location: currentAgentData?.current_location || agentData.current_location,
          user_id: agentUser.id,
        },
        {
          ...otherAgentUser,
          current_location: currentOtherAgentData?.current_location || otherAgentData.current_location,
          user_id: otherAgentUser.id,
        },
        world,
        conversationHistory,
        currentHour,
        turnNumber,
        maxTurns
      );

      // Store turn
      await addPlaygroundTurn(
        interaction.id,
        turnNumber,
        `agent_${agentUser.id}`,
        otherAgentUser.id,
        result.response,
        result.action.type,
        result.action.target,
        currentAgentData?.current_location || agentData.current_location,
        result.newLocation
      );

      // Store conversation
      await addPlaygroundConversation(
        interaction.id,
        turnNumber,
        agentUser.id,
        otherAgentUser.id,
        result.response
      );

      // Update agent location if changed
      if (result.newLocation !== (currentAgentData?.current_location || agentData.current_location)) {
        await updatePlaygroundAgent(agentUser.id, {
          current_location: result.newLocation,
          last_interaction_at: new Date().toISOString(),
        });
      }

      // Update interaction after each turn
      const isComplete = turnNumber === maxTurns;
      await updateInteraction(interaction.id, {
        turn_count: turnNumber,
        status: isComplete ? 'completed' : 'in_progress',
      });
    }
  }

  // Update world's last processed hour
  await updatePlaygroundWorld({ last_interaction_hour: currentHour });

  return { success: true, processed: agents.length, hour: currentHour };
}
