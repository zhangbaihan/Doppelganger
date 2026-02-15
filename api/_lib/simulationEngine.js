import { OpenAI } from 'openai';
import {
  getUserById,
  getConversations,
  updateSimulationRun,
  addSimulationState,
  getSimulationRuns,
  getAllUsers,
  updateSimulation,
} from './db.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ── Build agent system prompt for simulation ───────────────────── */

async function buildAgentSystemPrompt(agentUser, otherAgent, worldState, conversationHistory) {
  const conversations = await getConversations(Number(agentUser.id));
  const historyStr = conversations
    .map((c) => `${agentUser.name}: ${c.user_message}`)
    .join('\n\n');

  const availableItems = worldState.items
    .map((item) => `${item.name} at position (${item.x}, ${item.y})`)
    .join(', ');

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

async function processAgentTurn(agent, otherAgent, worldState, conversationHistory) {
  try {
    const systemPrompt = await buildAgentSystemPrompt(agent, otherAgent, worldState, conversationHistory);

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

  // Get participant users
  const agents = [];
  const allUsers = await getAllUsers();
  const usedUserIds = new Set();

  for (let i = 0; i < participants.length; i++) {
    const participant = participants[i];
    let user;

    if (participant.isRandom || participant.userId === 'random') {
      const availableUsers = allUsers.filter((u) => !usedUserIds.has(Number(u.id)));
      if (availableUsers.length === 0) {
        user = allUsers[Math.floor(Math.random() * allUsers.length)];
      } else {
        user = availableUsers[Math.floor(Math.random() * availableUsers.length)];
      }
    } else {
      user = await getUserById(participant.userId);
    }

    if (!user) {
      throw new Error(`Invalid participant at index ${i}`);
    }

    usedUserIds.add(Number(user.id));
    agents.push({
      ...user,
      id: Number(user.id),
      role: `agent${i + 1}`,
    });
  }

  if (agents.length < 2) {
    throw new Error('At least 2 participants are required');
  }

  // Initialize world state
  const boardWidth = 600;
  const boardHeight = 400;
  const agentPositions = {};

  agents.forEach((agent, index) => {
    const angle = (index / agents.length) * Math.PI * 2;
    const radius = Math.min(boardWidth, boardHeight) * 0.25;
    const centerX = boardWidth / 2;
    const centerY = boardHeight / 2;
    agentPositions[agent.role] = {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
    agent.currentPosition = agentPositions[agent.role];
  });

  const worldState = {
    items: items || [],
    agentPositions,
  };

  // Get the simulation run
  const runs = await getSimulationRuns(simulationId);
  const run = runs.find((r) => Number(r.run_index) === runIndex);
  if (!run) {
    throw new Error('Simulation run not found');
  }

  const runId = Number(run.id);
  await updateSimulationRun(runId, { status: 'running' });

  let conversationHistory = '';
  let stateIndex = 0;
  const maxTurns = 10;
  const narrativeEvents = [];

  // Initial state
  await addSimulationState(
    runId,
    stateIndex++,
    { ...worldState.agentPositions },
    conversationHistory,
    worldState.items,
    [],
    0
  );

  // Conversation loop
  for (let turn = 0; turn < maxTurns; turn++) {
    const turnResults = [];

    for (let i = 0; i < agents.length; i++) {
      const currentAgent = agents[i];
      const otherAgents = agents.filter((_, idx) => idx !== i);
      const otherAgent = otherAgents[0] || agents[(i + 1) % agents.length];

      const result = await processAgentTurn(
        currentAgent,
        otherAgent,
        worldState,
        conversationHistory
      );

      conversationHistory += `\n${currentAgent.bit_name}: ${result.response}`;
      if (result.narrativeEvent) {
        narrativeEvents.push(result.narrativeEvent);
        conversationHistory += `\n[${result.narrativeEvent}]`;
      }

      turnResults.push({ agent: currentAgent, result });

      if (
        result.response.toLowerCase().includes('goodbye') ||
        result.response.toLowerCase().includes('see you')
      ) {
        break;
      }
    }

    // Handle mutual movement
    const moveActions = turnResults.filter(
      (tr) => tr.result.action.type === 'move' && tr.result.action.target
    );
    if (moveActions.length >= 2) {
      const targetName = moveActions[0].result.action.target;
      const allAgree = moveActions.every(
        (ma) => ma.result.action.target.toLowerCase() === targetName.toLowerCase()
      );

      if (allAgree) {
        const targetItem = worldState.items.find(
          (item) => item.name.toLowerCase() === targetName.toLowerCase()
        );
        if (targetItem) {
          moveActions.forEach((ma, idx) => {
            const angle = (idx / moveActions.length) * Math.PI * 2;
            const offset = 20;
            ma.agent.currentPosition = {
              x: targetItem.x + Math.cos(angle) * offset,
              y: targetItem.y + Math.sin(angle) * offset,
            };
            worldState.agentPositions[ma.agent.role] = ma.agent.currentPosition;
          });
          narrativeEvents.push(`All agents move to the ${targetItem.name}`);
          conversationHistory += `\n[All agents move to the ${targetItem.name}]`;
        }
      }
    }

    // Save state
    await addSimulationState(
      runId,
      stateIndex++,
      { ...worldState.agentPositions },
      conversationHistory,
      worldState.items,
      [...narrativeEvents],
      turn
    );

    if (
      turnResults.some(
        (tr) =>
          tr.result.response.toLowerCase().includes('goodbye') ||
          tr.result.response.toLowerCase().includes('see you')
      )
    ) {
      break;
    }
  }

  await updateSimulationRun(runId, { status: 'completed' });
  return { success: true, states: stateIndex };
}
