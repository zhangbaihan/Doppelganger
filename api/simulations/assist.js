import OpenAI, { toFile } from 'openai';
import { getAllUsers } from '../_lib/db.js';
import { verifyToken } from '../_lib/auth.js';
import { apiHandler } from '../_lib/handler.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const tools = [
  {
    type: 'function',
    function: {
      name: 'add_item',
      description: 'Add a furniture item or feature to the simulation world. Use this to create atmosphere (e.g. "Romantic Table", "Couch", "Bar Counter", "Dance Floor", "Whiteboard").',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name' },
          x: { type: 'number', description: 'X position on board (0-600)' },
          y: { type: 'number', description: 'Y position on board (0-400)' },
        },
        required: ['name', 'x', 'y'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_item',
      description: 'Remove an item from the world by name',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of item to remove' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'clear_items',
      description: 'Remove all items from the world to start fresh',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_participant',
      description: 'Add a specific user\'s AI agent to the simulation by their user ID',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'User ID to add' },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'remove_participant',
      description: 'Remove a participant from the simulation by their user ID',
      parameters: {
        type: 'object',
        properties: {
          userId: { type: 'number', description: 'User ID to remove' },
        },
        required: ['userId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_goal',
      description: 'Set the simulation goal/scenario that determines what the user is looking for',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'The goal, e.g. "Find a romantic partner", "Find a hackathon teammate", "Find a good friend"',
          },
        },
        required: ['goal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_simulation',
      description: 'Start running the simulation. Set withAllUsers to true to run 1-on-1 pairings with every other user.',
      parameters: {
        type: 'object',
        properties: {
          withAllUsers: {
            type: 'boolean',
            description: 'If true, run 1-on-1 with all other users. If false, run with participants currently in the world.',
          },
        },
        required: ['withAllUsers'],
      },
    },
  },
];

export default apiHandler(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const decoded = verifyToken(req.headers.authorization);
  if (!decoded) return res.status(401).json({ error: 'Unauthorized' });

  const { message, audioBase64, currentState, chatHistory } = req.body || {};

  // Determine user text: transcribe audio or use message directly
  let userText = message;

  if (audioBase64 && !userText) {
    const buffer = Buffer.from(audioBase64, 'base64');
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
    const transcription = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });
    userText = transcription.text;
    if (!userText || !userText.trim()) {
      return res.status(400).json({ error: 'Could not transcribe audio.' });
    }
  }

  if (!userText) {
    return res.status(400).json({ error: 'No message provided' });
  }

  // Fetch available users for context
  const allUsers = await getAllUsers();
  const usersStr = allUsers
    .map((u) => `- ID: ${u.id}, Name: ${u.name}`)
    .join('\n');

  const state = currentState || {};
  const itemsStr = (state.items || []).map((i) => `${i.name} at (${i.x}, ${i.y})`).join(', ') || 'None';
  const participantsStr = (state.participants || []).map((p) => `${p.name} (ID: ${p.userId})`).join(', ') || 'None';

  const systemPrompt = `You are a simulation assistant for the Doppelganger app. You help users set up and run simulated worlds where AI agents interact with each other.

AVAILABLE USERS (you can add any of these as participants):
${usersStr}

CURRENT WORLD STATE:
- Items in world: ${itemsStr}
- Participants in world: ${participantsStr}
- Goal: ${state.goal || 'Not set yet'}

YOUR ROLE:
- Help the user set up simulations by adding items to create a scene, adding participants, and setting goals.
- When a user describes a scenario (e.g. "I want to find a date at a restaurant"), you MUST call ALL the necessary tools: set_goal, clear_items, add_item (multiple), and start_simulation. Call them all in a SINGLE response using parallel tool calls. Do NOT just describe what you will do — actually call the tools.
- Be creative with world setup! A restaurant scene should have tables, candles, a bar, etc. A hackathon scene should have workstations, whiteboards, coffee, snack table, etc.
- Spread items across the board (600 wide x 400 tall). Don't cluster everything in one spot.
- Keep your text response brief (1-2 sentences). The tool calls do the real work.
- If the user wants to test many people, use start_simulation with withAllUsers: true.
- If they just want specific people to interact, add those participants and start with withAllUsers: false.
- IMPORTANT: Always call the tools. Never just describe what you would do.`;

  // Build conversation messages
  const messages = [{ role: 'system', content: systemPrompt }];
  if (chatHistory && Array.isArray(chatHistory)) {
    for (const m of chatHistory.slice(-8)) {
      messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text });
    }
  }
  messages.push({ role: 'user', content: userText });

  // Multi-turn tool calling: loop until the model stops calling tools
  const allToolCalls = [];
  let finalMessage = '';
  const MAX_TOOL_ROUNDS = 4;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
    });

    const choice = completion.choices[0].message;

    if (choice.content) {
      finalMessage = choice.content;
    }

    if (!choice.tool_calls || choice.tool_calls.length === 0) {
      // No more tool calls — model is done
      break;
    }

    // Collect tool calls from this round
    const roundCalls = choice.tool_calls.map((tc) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments),
    }));
    allToolCalls.push(...roundCalls);

    // Append the assistant message (with tool_calls) to the conversation
    messages.push(choice);

    // Send back tool results so the model can continue
    for (const tc of choice.tool_calls) {
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify({ success: true }),
      });
    }

    // If start_simulation was called, no need for more rounds
    if (roundCalls.some((tc) => tc.name === 'start_simulation')) {
      break;
    }
  }

  // If there are tool calls but no text, generate a summary
  if (!finalMessage && allToolCalls.length > 0) {
    const actions = allToolCalls.map((tc) => tc.name.replace(/_/g, ' ')).join(', ');
    finalMessage = `Setting things up: ${actions}...`;
  }

  res.json({
    message: finalMessage,
    transcription: audioBase64 ? userText : undefined,
    toolCalls: allToolCalls,
  });
});
