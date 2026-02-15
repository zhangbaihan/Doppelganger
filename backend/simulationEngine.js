import { OpenAI } from 'openai';
import dotenv from 'dotenv';
import {
  getUserById,
  getConversations,
  getSimulationRun,
  updateSimulationRun,
  addSimulationState,
  getSimulationRuns,
  getAllUsers,
} from './db.js';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Build agent system prompt for simulation ───────────────────── */

function buildAgentSystemPrompt(agentUser, otherAgent, worldState, conversationHistory) {
  const conversations = getConversations(agentUser.id);
  const historyStr = conversations
    .map((c) => `${agentUser.name}: ${c.user_message}\n${agentUser.bit_name}: ${c.agent_response}`)
    .join('\n\n');

  const availableItems = worldState.items
    .map((item) => `${item.name} at position (${item.x}, ${item.y})`)
    .join(', ');

  const agent1Pos = worldState.agentPositions.agent1;
  const agent2Pos = worldState.agentPositions.agent2;

  return `You are ${agentUser.bit_name}, an AI agent representing ${agentUser.name} in a simulated space.

YOUR TRAINING DATA (what you know about ${agentUser.name}):
${historyStr || 'No training data yet.'}

CURRENT WORLD STATE:
- Available items in the space: ${availableItems || 'None'}
- Your current position: (${agentUser.currentPosition.x}, ${agentUser.currentPosition.y})
- ${otherAgent.bit_name}'s position: (${otherAgent.currentPosition.x}, ${otherAgent.currentPosition.y})

CONVERSATION SO FAR:
${conversationHistory || 'Conversation just started.'}

INSTRUCTIONS:
- You are having a natural conversation with ${otherAgent.bit_name}
- You can suggest moving to items (couch, table, etc.) if it makes sense contextually
- You can agree to move if the other agent suggests it
- Be natural and conversational - movement decisions should feel organic
- Reference items by their exact names as listed above

You MUST respond with valid JSON using this exact structure:
{
  "response": "Your natural conversational text response",
  "action": {
    "type": "move" | "interact" | "none",
    "target": "item name or null",
    "reasoning": "Brief explanation of your action decision"
  }
}

Examples:
- "Let's sit at the couch" → {"type": "move", "target": "couch", "reasoning": "Suggesting to move to couch"}
- "Sure, I'll join you at the table" → {"type": "move", "target": "table", "reasoning": "Agreeing to move to table"}
- Just talking → {"type": "none", "target": null, "reasoning": "Continuing conversation"}`;
}

/* ── Process agent turn ──────────────────────────────────────────── */

async function processAgentTurn(agent, otherAgent, worldState, conversationHistory, stateIndex) {
  try {
    const systemPrompt = buildAgentSystemPrompt(agent, otherAgent, worldState, conversationHistory);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Continue the conversation. ${otherAgent.bit_name} just said: "${conversationHistory.split('\n').pop() || 'Hello!'}"`,
        },
      ],
      temperature: 0.8,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    const response = result.response || '...';
    const action = result.action || { type: 'none', target: null, reasoning: '' };

    // Process movement action
    let narrativeEvent = null;
    if (action.type === 'move' && action.target) {
      const targetItem = worldState.items.find(
        (item) => item.name.toLowerCase() === action.target.toLowerCase()
      );

      if (targetItem) {
        // Update agent position to item location (with slight offset for multiple agents)
        const offsetX = agent.role === 'agent1' ? -10 : 10;
        const offsetY = agent.role === 'agent1' ? -10 : 10;
        agent.currentPosition = {
          x: targetItem.x + offsetX,
          y: targetItem.y + offsetY,
        };

        worldState.agentPositions[agent.role] = agent.currentPosition;
        narrativeEvent = `${agent.bit_name} moves to the ${targetItem.name}`;
      }
    }

    return {
      response,
      action,
      narrativeEvent,
      agentName: agent.bit_name,
    };
  } catch (error) {
    console.error('Error processing agent turn:', error);
    return {
      response: "I'm not sure what to say right now.",
      action: { type: 'none', target: null, reasoning: 'Error occurred' },
      narrativeEvent: null,
      agentName: agent.bit_name,
    };
  }
}

/* ── Run a single simulation ────────────────────────────────────── */

export async function runSimulation(simulationId, runIndex, config) {
  const { items, participants } = config;

  // Get participant users (handle random selection)
  let agent1User, agent2User;
  
  if (participants[0].isRandom) {
    const allUsers = getAllUsers();
    const randomUser = allUsers[Math.floor(Math.random() * allUsers.length)];
    agent1User = randomUser;
  } else {
    agent1User = getUserById(participants[0].userId);
  }

  if (participants[1]?.isRandom) {
    const allUsers = getAllUsers();
    const filteredUsers = allUsers.filter(u => u.id !== agent1User.id);
    const randomUser = filteredUsers.length > 0 
      ? filteredUsers[Math.floor(Math.random() * filteredUsers.length)]
      : allUsers[Math.floor(Math.random() * allUsers.length)];
    agent2User = randomUser;
  } else if (participants[1]?.userId) {
    agent2User = getUserById(participants[1].userId);
  } else {
    // Fallback: use agent1 if only one participant specified
    agent2User = agent1User;
  }

  if (!agent1User || !agent2User) {
    throw new Error('Invalid participants');
  }

  // Initialize world state
  const worldState = {
    items: items || [],
    agentPositions: {
      agent1: { x: 100, y: 100 }, // Starting positions
      agent2: { x: 500, y: 400 },
    },
  };

  // Initialize agents
  const agent1 = {
    ...agent1User,
    role: 'agent1',
    currentPosition: worldState.agentPositions.agent1,
  };
  const agent2 = {
    ...agent2User,
    role: 'agent2',
    currentPosition: worldState.agentPositions.agent2,
  };

  // Get simulation run
  const runs = getSimulationRuns(simulationId);
  const run = runs.find((r) => r.run_index === runIndex);
  if (!run) {
    throw new Error('Simulation run not found');
  }

  updateSimulationRun(run.id, { status: 'running' });

  let conversationHistory = '';
  let stateIndex = 0;
  const maxTurns = 20; // Limit conversation length
  const narrativeEvents = [];

  // Initial state
  addSimulationState(
    run.id,
    stateIndex++,
    { ...worldState.agentPositions },
    conversationHistory,
    worldState.items,
    [],
    0
  );

  // Conversation loop
  for (let turn = 0; turn < maxTurns; turn++) {
    // Agent 1's turn
    const agent1Result = await processAgentTurn(
      agent1,
      agent2,
      worldState,
      conversationHistory,
      stateIndex
    );

    conversationHistory += `\n${agent1.bit_name}: ${agent1Result.response}`;
    if (agent1Result.narrativeEvent) {
      narrativeEvents.push(agent1Result.narrativeEvent);
      conversationHistory += `\n[${agent1Result.narrativeEvent}]`;
    }

    // Save state after agent 1
    addSimulationState(
      run.id,
      stateIndex++,
      { ...worldState.agentPositions },
      conversationHistory,
      worldState.items,
      [...narrativeEvents],
      turn * 2
    );

    // Check for natural ending
    if (agent1Result.response.toLowerCase().includes('goodbye') || 
        agent1Result.response.toLowerCase().includes('see you')) {
      break;
    }

    // Agent 2's turn
    const agent2Result = await processAgentTurn(
      agent2,
      agent1,
      worldState,
      conversationHistory,
      stateIndex
    );

    conversationHistory += `\n${agent2.bit_name}: ${agent2Result.response}`;
    if (agent2Result.narrativeEvent) {
      narrativeEvents.push(agent2Result.narrativeEvent);
      conversationHistory += `\n[${agent2Result.narrativeEvent}]`;
    }

    // Handle mutual movement (both agents agree to move to same place)
    if (
      agent1Result.action.type === 'move' &&
      agent2Result.action.type === 'move' &&
      agent1Result.action.target === agent2Result.action.target
    ) {
      const targetItem = worldState.items.find(
        (item) => item.name.toLowerCase() === agent1Result.action.target.toLowerCase()
      );
      if (targetItem) {
        agent1.currentPosition = { x: targetItem.x - 15, y: targetItem.y - 15 };
        agent2.currentPosition = { x: targetItem.x + 15, y: targetItem.y + 15 };
        worldState.agentPositions.agent1 = agent1.currentPosition;
        worldState.agentPositions.agent2 = agent2.currentPosition;
        narrativeEvents.push(`Both agents move to the ${targetItem.name}`);
        conversationHistory += `\n[Both agents move to the ${targetItem.name}]`;
      }
    }

    // Save state after agent 2
    addSimulationState(
      run.id,
      stateIndex++,
      { ...worldState.agentPositions },
      conversationHistory,
      worldState.items,
      [...narrativeEvents],
      turn * 2 + 1
    );

    // Check for natural ending
    if (agent2Result.response.toLowerCase().includes('goodbye') || 
        agent2Result.response.toLowerCase().includes('see you')) {
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  updateSimulationRun(run.id, { status: 'completed' });
  return { success: true, states: stateIndex };
}
