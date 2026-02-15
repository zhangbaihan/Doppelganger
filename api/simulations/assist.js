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
      description: 'Add a furniture item or feature to the simulation world. Use this to create atmosphere (e.g. "Romantic Table", "Couch", "Bar Counter", "Dance Floor", "Whiteboard"). IMPORTANT: Spread items across the 600x400 board — keep at least 80px between items. Use the full board space: corners, edges, and center.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Item name' },
          x: { type: 'number', description: 'X position on board (40-560). Spread items out — do NOT cluster near center.' },
          y: { type: 'number', description: 'Y position on board (40-360). Use the full vertical range.' },
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
      name: 'set_simulation_mode',
      description: 'Configure the simulation run mode. Use "selected" when the user names specific people to simulate with (this runs ONLY with participants added via add_participant). Use "all_users" ONLY when the user explicitly asks to match with everyone in the database. If specific participants were added by name, you MUST use "selected". This does NOT start the simulation — the user will review the setup and click Start when ready.',
      parameters: {
        type: 'object',
        properties: {
          mode: {
            type: 'string',
            enum: ['all_users', 'selected'],
            description: '"all_users" = 1-on-1 with every user in the database. "selected" = only participants in the world.',
          },
        },
        required: ['mode'],
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
  const modeStr = state.simMode === 'all' ? '1-on-1 with all users' : state.simMode === 'selected' ? 'Selected participants only' : 'Not set yet';

  const systemPrompt = `You are a simulation assistant for the Doppelganger app. You help users set up and run simulated worlds where AI agents interact with each other.

AVAILABLE USERS (you can add any of these as participants):
${usersStr}

CURRENT WORLD STATE:
- Items in world: ${itemsStr}
- Participants in world: ${participantsStr}
- Goal: ${state.goal || 'Not set yet'}
- Simulation mode: ${modeStr}

YOUR ROLE:
- Help the user SET UP simulations by adding items to create a scene, adding participants, setting goals, and choosing the simulation mode. You do NOT start the simulation — the user will review your setup, make adjustments, and click Start when ready.
- When a user describes a scenario (e.g. "I want to find a date at a restaurant"), you MUST call ALL the necessary setup tools: set_goal, clear_items, add_item (multiple), and set_simulation_mode. Call them all in a SINGLE response using parallel tool calls. Do NOT just describe what you will do — actually call the tools.
- Be creative with world setup! A restaurant scene should have tables, candles, a bar, etc. A hackathon scene should have workstations, whiteboards, coffee, snack table, etc.
- CRITICAL POSITIONING RULE: The board is 600px wide × 400px tall. You MUST spread items across the ENTIRE board:
  * Use positions ranging from x=40 to x=560 and y=40 to y=360.
  * Keep at least 80-100px between items so they don't overlap.
  * Place items in different zones: corners (e.g. 80,80), edges (e.g. 300,40), center (e.g. 300,200), etc.
  * Think about spatial relationships: put the bar near the entrance (left side), seating in the center, dance floor on the right, etc.
  * NEVER place multiple items at the same or very similar coordinates.
- Keep your text response brief (1-2 sentences). After configuring, remind the user they can drag items around or make changes, then click Start.
- CRITICAL RULE FOR SIMULATION MODE:
  * If the user mentions ANY specific people by name (e.g. "simulate between Alice and Bob", "run a sim with John", "I'm choosing between Alice and Bob"), you MUST use set_simulation_mode with mode: "selected" and add ONLY those named users via add_participant. Do NOT use "all_users" when specific names are mentioned.
  * ONLY use set_simulation_mode with mode: "all_users" when the user explicitly asks to match with everyone, all users, or find the best match from the whole pool (e.g. "match me with everyone", "test against all users", "find my best match from the database").
  * When in doubt, default to "selected" mode — it is safer and respects the user's intent.
- CRITICAL RULE FOR PARTICIPANT INTENT: When the user says they are "choosing between", "hesitating between", or "comparing" specific people, they want to see how EACH of those people interacts with THEMSELVES (the current user). Add those named people as participants — do NOT add the current user as a participant. The system will automatically pair the current user with each named participant. For example, "I'm hesitating between Jay and Sagar" means the user wants: (me vs Jay) and (me vs Sagar), NOT (Jay vs Sagar).
- IMPORTANT: Always call the tools. Never just describe what you would do. But NEVER auto-start the simulation — only configure it.`;

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

    // If simulation mode was set, configuration is likely complete
    if (roundCalls.some((tc) => tc.name === 'set_simulation_mode')) {
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
