import { useState, useEffect, useRef, useCallback } from 'react';

const MAX_TURNS = 10;
const BOARD_W = 600;
const BOARD_H = 400;
const SESSION_KEY = 'doppel_sim_session';
const HISTORY_KEY = 'doppel_sim_history';

export default function SimulationWorkspace({ token, user }) {
  /* ── Phase: setup | running | results | history ────────────── */
  const [phase, setPhase] = useState('setup');

  /* ── Data ──────────────────────────────────────────────────── */
  const [allUsers, setAllUsers] = useState([]);
  const [items, setItems] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [goal, setGoal] = useState('');

  /* ── Assistant chat ────────────────────────────────────────── */
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [assistLoading, setAssistLoading] = useState(false);

  /* ── Live simulation ───────────────────────────────────────── */
  const [liveMessages, setLiveMessages] = useState([]);
  const [agentPositions, setAgentPositions] = useState({});
  const [pairingInfo, setPairingInfo] = useState('');
  const [turnCount, setTurnCount] = useState(0);
  const [simError, setSimError] = useState(null);

  /* ── Results ───────────────────────────────────────────────── */
  const [scores, setScores] = useState([]);

  /* ── History ───────────────────────────────────────────────── */
  const [history, setHistory] = useState([]);
  const [viewingHistoryItem, setViewingHistoryItem] = useState(null);

  /* ── Recording ─────────────────────────────────────────────── */
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);

  /* ── Left panel tab ─────────────────────────────────────────── */
  const [leftTab, setLeftTab] = useState('agents');

  /* ── Manual add item ───────────────────────────────────────── */
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState('');

  /* ── Item dragging ───────────────────────────────────────── */
  const [draggingItemId, setDraggingItemId] = useState(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const worldRef = useRef(null);

  /* ── Participant dragging ───────────────────────────────── */
  const [draggingParticipantId, setDraggingParticipantId] = useState(null);
  const participantDragStartRef = useRef({ x: 0, y: 0 });
  const participantDidDragRef = useRef(false);

  /* ── Simulation mode: null | 'all' | 'selected' ───────────── */
  const [simMode, setSimMode] = useState(null);

  /* ── Simulation control ─────────────────────────────────────── */
  const [thinkingAgent, setThinkingAgent] = useState(null);
  const abortRef = useRef(false);
  const abortControllerRef = useRef(null);

  /* ── Refs ───────────────────────────────────────────────────── */
  const transcriptRef = useRef(null);
  const chatEndRef = useRef(null);

  /* ── Init on mount ─────────────────────────────────────────── */

  useEffect(() => {
    loadUsers();
    loadHistory();

    // Clear any stale session data from previous versions
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }

    setChatMessages([
      {
        role: 'assistant',
        text: "Describe what kind of simulation you'd like to run. For example: \"I want to be matched with a date! Simulate dates with other users grabbing coffee at CoHo\" or \"Help me find a hackathon partner\". I'll set up the world for you — then you can drag things around and click Start when you're ready!",
      },
    ]);
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, assistLoading]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [liveMessages]);

  /* ── History helpers ───────────────────────────────────────── */

  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch (e) { /* noop */ }
  }

  function saveToHistory(simData) {
    try {
      const existing = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      const updated = [simData, ...existing].slice(0, 20); // keep last 20
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setHistory(updated);
    } catch (e) { /* noop */ }
  }

  function deleteHistoryItem(id) {
    try {
      const existing = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
      const updated = existing.filter((h) => h.id !== id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
      setHistory(updated);
      if (viewingHistoryItem?.id === id) {
        setViewingHistoryItem(null);
        setPhase('setup');
      }
    } catch (e) { /* noop */ }
  }

  /* ── Load users ────────────────────────────────────────────── */

  async function loadUsers() {
    try {
      const res = await fetch('/api/simulations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAllUsers(data.users || []);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  /* ── Drag and drop ─────────────────────────────────────────── */

  function handleDragStart(e, userId) {
    e.dataTransfer.setData('text/plain', String(userId));
  }

  function handleWorldDrop(e) {
    e.preventDefault();
    const userId = parseInt(e.dataTransfer.getData('text/plain'));
    if (!userId || isNaN(userId)) return;
    const u = allUsers.find((a) => Number(a.id) === userId);
    if (!u) return;
    if (participants.find((p) => p.userId === userId)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(20, Math.min(e.clientX - rect.left, BOARD_W - 20));
    const y = Math.max(20, Math.min(e.clientY - rect.top, BOARD_H - 20));

    setParticipants((prev) => [
      ...prev,
      { userId, name: u.name, bitName: u.name, position: { x, y } },
    ]);
  }

  function handleWorldDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  function removeParticipant(userId) {
    setParticipants((prev) => prev.filter((p) => p.userId !== userId));
  }

  /* ── Item management ───────────────────────────────────────── */

  function addItem(name, x, y) {
    setItems((prev) => [...prev, { id: Date.now() + Math.random(), name, x, y }]);
  }

  function removeItem(id) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  function handleManualAddItem() {
    if (!newItemName.trim()) return;
    addItem(newItemName.trim(), BOARD_W / 2, BOARD_H / 2);
    setNewItemName('');
    setShowAddItem(false);
  }

  /* ── Item dragging handlers ─────────────────────────────────── */

  const handleItemMouseDown = useCallback((e, itemId) => {
    if (phase !== 'setup') return;
    e.preventDefault();
    e.stopPropagation();
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: e.clientX - rect.left - item.x,
      y: e.clientY - rect.top - item.y,
    };
    setDraggingItemId(itemId);
  }, [phase, items]);

  const handleItemMouseMove = useCallback((e) => {
    if (draggingItemId == null) return;
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(20, Math.min(e.clientX - rect.left - dragOffsetRef.current.x, BOARD_W - 20));
    const y = Math.max(20, Math.min(e.clientY - rect.top - dragOffsetRef.current.y, BOARD_H - 20));
    setItems((prev) =>
      prev.map((item) => (item.id === draggingItemId ? { ...item, x, y } : item))
    );
  }, [draggingItemId]);

  const handleItemMouseUp = useCallback(() => {
    setDraggingItemId(null);
  }, []);

  useEffect(() => {
    if (draggingItemId != null) {
      window.addEventListener('mousemove', handleItemMouseMove);
      window.addEventListener('mouseup', handleItemMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleItemMouseMove);
        window.removeEventListener('mouseup', handleItemMouseUp);
      };
    }
  }, [draggingItemId, handleItemMouseMove, handleItemMouseUp]);

  /* ── Participant dragging handlers ───────────────────────── */

  const handleParticipantMouseDown = useCallback((e, userId) => {
    if (phase !== 'setup') return;
    e.preventDefault();
    e.stopPropagation();
    const p = participants.find((pp) => pp.userId === userId);
    if (!p) return;
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragOffsetRef.current = {
      x: e.clientX - rect.left - p.position.x,
      y: e.clientY - rect.top - p.position.y,
    };
    participantDragStartRef.current = { x: e.clientX, y: e.clientY };
    participantDidDragRef.current = false;
    setDraggingParticipantId(userId);
  }, [phase, participants]);

  const handleParticipantMouseMove = useCallback((e) => {
    if (draggingParticipantId == null) return;
    const dx = e.clientX - participantDragStartRef.current.x;
    const dy = e.clientY - participantDragStartRef.current.y;
    if (!participantDidDragRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
      participantDidDragRef.current = true;
    }
    const rect = worldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.max(20, Math.min(e.clientX - rect.left - dragOffsetRef.current.x, BOARD_W - 20));
    const y = Math.max(20, Math.min(e.clientY - rect.top - dragOffsetRef.current.y, BOARD_H - 20));
    setParticipants((prev) =>
      prev.map((p) => (p.userId === draggingParticipantId ? { ...p, position: { x, y } } : p))
    );
  }, [draggingParticipantId]);

  const handleParticipantMouseUp = useCallback(() => {
    if (draggingParticipantId != null && !participantDidDragRef.current) {
      removeParticipant(draggingParticipantId);
    }
    setDraggingParticipantId(null);
  }, [draggingParticipantId]);

  useEffect(() => {
    if (draggingParticipantId != null) {
      window.addEventListener('mousemove', handleParticipantMouseMove);
      window.addEventListener('mouseup', handleParticipantMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleParticipantMouseMove);
        window.removeEventListener('mouseup', handleParticipantMouseUp);
      };
    }
  }, [draggingParticipantId, handleParticipantMouseMove, handleParticipantMouseUp]);

  /* ── Assistant chat ────────────────────────────────────────── */

  async function handleChatSubmit(text) {
    if (!text?.trim()) return;
    const userMsg = text.trim();
    setChatInput('');
    setChatMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    await callAssist({ message: userMsg });
  }

  async function callAssist(payload) {
    setAssistLoading(true);
    try {
      const res = await fetch('/api/simulations/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ...payload,
          currentState: { items, participants, goal, simMode },
          chatHistory: chatMessages.slice(-10),
        }),
      });

      if (!res.ok) throw new Error('Assistant failed');
      const data = await res.json();

      if (data.transcription) {
        setChatMessages((prev) => {
          const updated = [...prev];
          for (let i = updated.length - 1; i >= 0; i--) {
            if (updated[i].role === 'user') {
              updated[i] = { role: 'user', text: data.transcription };
              break;
            }
          }
          return updated;
        });
      }

      if (data.message) {
        setChatMessages((prev) => [...prev, { role: 'assistant', text: data.message }]);
      }

      if (data.toolCalls && data.toolCalls.length > 0) {
        executeToolCalls(data.toolCalls);
      }
    } catch (err) {
      console.error('Assist error:', err);
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', text: 'Sorry, something went wrong. Try again!' },
      ]);
    } finally {
      setAssistLoading(false);
    }
  }

  /* ── Smart layout: resolve overlapping items ───────────────── */

  function resolveItemLayout(itemsList) {
    if (itemsList.length <= 1) return itemsList;

    const PADDING = 80; // minimum distance between item centers
    const MARGIN = 40;  // board edge margin
    const resolved = [...itemsList];

    // Check if items are overlapping (within PADDING distance)
    function hasOverlap(list) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const dx = list[i].x - list[j].x;
          const dy = list[i].y - list[j].y;
          if (Math.sqrt(dx * dx + dy * dy) < PADDING) return true;
        }
      }
      return false;
    }

    if (!hasOverlap(resolved)) return resolved;

    // Items overlap — redistribute using a smart grid layout
    const count = resolved.length;
    const usableW = BOARD_W - MARGIN * 2;
    const usableH = BOARD_H - MARGIN * 2;

    // Determine grid dimensions
    const cols = Math.ceil(Math.sqrt(count * (usableW / usableH)));
    const rows = Math.ceil(count / cols);
    const cellW = usableW / cols;
    const cellH = usableH / rows;

    for (let i = 0; i < resolved.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      // Center item within its grid cell, with slight randomness for natural look
      const jitterX = (Math.random() - 0.5) * cellW * 0.2;
      const jitterY = (Math.random() - 0.5) * cellH * 0.2;
      resolved[i] = {
        ...resolved[i],
        x: Math.round(Math.max(MARGIN, Math.min(BOARD_W - MARGIN, MARGIN + cellW * (col + 0.5) + jitterX))),
        y: Math.round(Math.max(MARGIN, Math.min(BOARD_H - MARGIN, MARGIN + cellH * (row + 0.5) + jitterY))),
      };
    }

    return resolved;
  }

  /* ── Execute tool calls from LLM ───────────────────────────── */

  function executeToolCalls(toolCalls) {
    let localItems = [...items];
    let localParticipants = [...participants];
    let localGoal = goal;
    let localSimMode = simMode;
    let itemsAdded = 0;

    for (const call of toolCalls) {
      const args = call.args || {};
      switch (call.name) {
        case 'add_item':
          localItems = [
            ...localItems,
            { id: Date.now() + Math.random(), name: args.name, x: args.x || 300, y: args.y || 200 },
          ];
          itemsAdded++;
          break;
        case 'remove_item':
          localItems = localItems.filter(
            (i) => i.name.toLowerCase() !== (args.name || '').toLowerCase()
          );
          break;
        case 'clear_items':
          localItems = [];
          break;
        case 'add_participant': {
          const u = allUsers.find((a) => Number(a.id) === args.userId);
          if (u && !localParticipants.find((p) => p.userId === args.userId)) {
            const angle = Math.random() * Math.PI * 2;
            localParticipants = [
              ...localParticipants,
              {
                userId: args.userId,
                name: u.name,
                bitName: u.name,
                position: {
                  x: BOARD_W / 2 + Math.cos(angle) * 100,
                  y: BOARD_H / 2 + Math.sin(angle) * 100,
                },
              },
            ];
          }
          break;
        }
        case 'remove_participant':
          localParticipants = localParticipants.filter((p) => p.userId !== args.userId);
          break;
        case 'set_goal':
          localGoal = args.goal || '';
          break;
        case 'set_simulation_mode':
          localSimMode = args.mode === 'all_users' ? 'all' : 'selected';
          break;
      }
    }

    // If items were added, resolve any overlapping positions
    if (itemsAdded > 0) {
      localItems = resolveItemLayout(localItems);
    }

    setItems(localItems);
    setParticipants(localParticipants);
    setGoal(localGoal);
    setSimMode(localSimMode);
  }

  /* ── Simulation execution ──────────────────────────────────── */

  async function startSimulation(withAllUsers, simItems, simParticipants, simGoal) {
    const currentItems = simItems || items;
    const currentParticipants = simParticipants || participants;
    const currentGoal = simGoal || goal;
    const currentUserId = user.id;

    setPhase('running');
    setLiveMessages([]);
    setScores([]);
    setTurnCount(0);
    setSimError(null);
    setViewingHistoryItem(null);
    setThinkingAgent(null);
    abortRef.current = false;

    let pairings = [];

    if (withAllUsers) {
      const others = allUsers.filter((u) => Number(u.id) !== currentUserId);
      pairings = others.map((other) => ({
        agents: [
          { userId: currentUserId, name: user.name, bitName: user.name, role: 'agent1' },
          { userId: Number(other.id), name: other.name, bitName: other.name, role: 'agent2' },
        ],
      }));
    } else {
      if (currentParticipants.length < 2) {
        const hasMe = currentParticipants.find((p) => p.userId === currentUserId);
        if (!hasMe && currentParticipants.length === 1) {
          pairings = [
            {
              agents: [
                { userId: currentUserId, name: user.name, bitName: user.name, role: 'agent1' },
                {
                  userId: currentParticipants[0].userId,
                  name: currentParticipants[0].name,
                  bitName: currentParticipants[0].bitName,
                  role: 'agent2',
                },
              ],
            },
          ];
        } else {
          setChatMessages((prev) => [
            ...prev,
            { role: 'assistant', text: 'Need at least 2 participants. Drag some users into the world first!' },
          ]);
          setPhase('setup');
          return;
        }
      } else {
        const me = currentParticipants.find((p) => p.userId === currentUserId) || currentParticipants[0];
        const others = currentParticipants.filter((p) => p.userId !== me.userId);
        pairings = others.map((other) => ({
          agents: [
            { userId: me.userId, name: me.name, bitName: me.bitName, role: 'agent1' },
            { userId: other.userId, name: other.name, bitName: other.bitName, role: 'agent2' },
          ],
        }));
      }
    }

    if (pairings.length === 0) {
      setSimError(
        withAllUsers
          ? 'No other users found. You need at least one other person to simulate with!'
          : 'No valid pairings found. Drag some users into the world first!'
      );
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: withAllUsers
            ? 'No other users found to pair with. There needs to be at least one other trained user in the system.'
            : 'No valid pairings found.',
        },
      ]);
      setPhase('setup');
      return;
    }

    const allResults = [];
    const allLiveMessages = [];

    for (let pi = 0; pi < pairings.length; pi++) {
      const pairing = pairings[pi];
      const agent1 = pairing.agents[0];
      const agent2 = pairing.agents[1];

      setPairingInfo(
        `${agent1.bitName} meets ${agent2.bitName} (${pi + 1}/${pairings.length})`
      );

      if (pi > 0) {
        const sep = {
          speaker: null,
          text: `\u2500\u2500\u2500 ${agent1.bitName} meets ${agent2.bitName} \u2500\u2500\u2500`,
          isNarrative: true,
        };
        allLiveMessages.push(sep);
        setLiveMessages((prev) => [...prev, sep]);
      }

      const positions = {
        agent1: { x: BOARD_W * 0.3, y: BOARD_H / 2 },
        agent2: { x: BOARD_W * 0.7, y: BOARD_H / 2 },
      };
      setAgentPositions({ ...positions });

      let conversationHistory = '';
      let done = false;

      for (let turn = 0; turn < MAX_TURNS && !done; turn++) {
        // Check for manual abort
        if (abortRef.current) {
          const abortMsg = { speaker: null, text: 'Simulation stopped by user.', isNarrative: true };
          allLiveMessages.push(abortMsg);
          setLiveMessages((prev) => [...prev, abortMsg]);
          done = true;
          break;
        }

        setTurnCount(turn + 1);
        setThinkingAgent(`${agent1.bitName} and ${agent2.bitName} are thinking...`);

        try {
          const controller = new AbortController();
          abortControllerRef.current = controller;

          const res = await fetch('/api/simulations/step', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              action: 'step',
              agents: pairing.agents.map((a) => ({
                ...a,
                position: positions[a.role],
              })),
              items: currentItems.map(({ id, ...rest }) => rest),
              conversationHistory,
              goal: currentGoal,
            }),
            signal: controller.signal,
          });

          abortControllerRef.current = null;
          setThinkingAgent(null);

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `Step failed (${res.status})`);
          }
          const data = await res.json();

          // Check if engine reported an error in turn results
          if (data.error) {
            throw new Error(data.error);
          }

          conversationHistory = data.conversationHistory;

          if (data.agentPositions) {
            Object.assign(positions, data.agentPositions);
            setAgentPositions({ ...positions });
          }

          for (const tr of data.turnResults) {
            if (tr.error) {
              const errMsg = { speaker: tr.agentName, text: `Error: ${tr.error}`, isNarrative: true };
              allLiveMessages.push(errMsg);
              setLiveMessages((prev) => [...prev, errMsg]);
              done = true;
              break;
            }
            const msg = { speaker: tr.agentName, text: tr.response, isNarrative: false };
            allLiveMessages.push(msg);
            setLiveMessages((prev) => [...prev, msg]);
            if (tr.narrativeEvent) {
              const narr = { speaker: null, text: tr.narrativeEvent, isNarrative: true };
              allLiveMessages.push(narr);
              setLiveMessages((prev) => [...prev, narr]);
            }
          }

          done = done || data.done;
        } catch (err) {
          abortControllerRef.current = null;
          setThinkingAgent(null);
          if (err.name === 'AbortError') {
            const stopMsg = { speaker: null, text: 'Simulation stopped by user.', isNarrative: true };
            allLiveMessages.push(stopMsg);
            setLiveMessages((prev) => [...prev, stopMsg]);
          } else {
            console.error('Step error:', err);
            const errMsg = { speaker: null, text: `Error: ${err.message}`, isNarrative: true };
            allLiveMessages.push(errMsg);
            setLiveMessages((prev) => [...prev, errMsg]);
          }
          done = true;
        }
      }

      allResults.push({
        userId: agent2.userId,
        userName: agent2.name,
        bitName: agent2.bitName,
        transcript: conversationHistory,
      });
    }

    // Compute compatibility scores
    setThinkingAgent(null);
    let finalScores = [];
    if (currentGoal && allResults.length > 0 && !abortRef.current) {
      setPairingInfo('Computing compatibility scores...');
      setThinkingAgent('Evaluating compatibility...');
      try {
        const res = await fetch('/api/simulations/step', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            action: 'score',
            goal: currentGoal,
            userName: user.name,
            pairings: allResults,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          finalScores = data.scores || [];
          setScores(finalScores);
        }
      } catch (err) {
        console.error('Score error:', err);
      }
    }

    setThinkingAgent(null);
    setPhase('results');
    setPairingInfo('');

    // Save to history
    saveToHistory({
      id: Date.now(),
      date: new Date().toISOString(),
      goal: currentGoal,
      scores: finalScores,
      liveMessages: allLiveMessages,
      items: currentItems,
    });
  }

  /* ── Voice recording ───────────────────────────────────────── */

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { audioBitsPerSecond: 32000 });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        await sendVoice(blob);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
    } catch (err) {
      console.error('Mic error:', err);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  async function sendVoice(blob) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

    setChatMessages((prev) => [...prev, { role: 'user', text: '(voice message...)' }]);
    await callAssist({ audioBase64: base64 });
  }

  /* ── View a history item ───────────────────────────────────── */

  function viewHistory(item) {
    setViewingHistoryItem(item);
    setLiveMessages(item.liveMessages || []);
    setScores(item.scores || []);
    setGoal(item.goal || '');
    setItems(item.items || []);
    setPhase('results');
  }

  /* ── Render ────────────────────────────────────────────────── */

  const participantIds = new Set(participants.map((p) => p.userId));
  const isViewing = phase === 'results' || phase === 'running';

  return (
    <div className="sim-workspace">
      {/* ═══ LEFT PANEL ═══ */}
      <div className="sim-left-panel">
        {phase === 'results' && scores.length > 0 ? (
          <>
            <h3 className="sim-panel-title">COMPATIBILITY</h3>
            {goal && <p className="sim-panel-hint">{goal}</p>}
            <div className="sim-scores-list">
              {[...scores]
                .sort((a, b) => (b.score || 0) - (a.score || 0))
                .map((s, i) => {
                  const sc = s.score || 0;
                  const tier =
                    sc >= 79 ? 'excellent' : sc >= 66 ? 'good' : sc >= 51 ? 'above-avg' : sc >= 36 ? 'average' : sc >= 6 ? 'below-avg' : 'incompatible';
                  return (
                    <div key={s.userId || i} className={`sim-score-card sim-score-tier-${tier}`}>
                      <div className="sim-score-rank">#{i + 1}</div>
                      <div className="sim-score-info">
                        <div className="sim-score-name">{s.userName || s.bitName}</div>
                        <div className="sim-score-bar-bg">
                          <div
                            className={`sim-score-bar sim-score-bar-${tier}`}
                            style={{ width: `${sc}%` }}
                          />
                        </div>
                        <div className={`sim-score-value sim-score-value-${tier}`}>{sc}%</div>
                        {s.reasoning && (
                          <div className="sim-score-reason">{s.reasoning}</div>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
            <button
              className="sim-reset-btn"
              onClick={() => {
                setPhase('setup');
                setScores([]);
                setLiveMessages([]);
                setAgentPositions({});
                setViewingHistoryItem(null);
                setSimMode(null);
              }}
            >
              NEW SIMULATION
            </button>
          </>
        ) : (
          <>
            {/* Tab toggle: AGENTS vs HISTORY */}
            <div className="sim-left-tabs">
              <button
                className={`sim-left-tab ${leftTab === 'agents' ? 'active' : ''}`}
                onClick={() => setLeftTab('agents')}
              >
                AGENTS
              </button>
              <button
                className={`sim-left-tab ${leftTab === 'history' ? 'active' : ''}`}
                onClick={() => setLeftTab('history')}
              >
                HISTORY {history.length > 0 ? `(${history.length})` : ''}
              </button>
            </div>

            {leftTab === 'agents' ? (
              <>
                <p className="sim-panel-hint">Drag to the world to add</p>
                <div className="sim-users-list">
                  {allUsers.map((u) => {
                    const inWorld = participantIds.has(Number(u.id));
                    return (
                      <div
                        key={u.id}
                        className={`sim-user-card ${inWorld ? 'in-world' : ''}`}
                        draggable={!inWorld && phase === 'setup'}
                        onDragStart={(e) => handleDragStart(e, Number(u.id))}
                      >
                        <div className="sim-user-avatar">
                          {(u.name || '?')[0].toUpperCase()}
                        </div>
                        <div className="sim-user-info">
                          <span className="sim-user-name">{u.name}</span>
                        </div>
                        {inWorld && <span className="sim-user-badge">IN WORLD</span>}
                      </div>
                    );
                  })}
                  {phase === 'setup' && (
                    showAddItem ? (
                      <div className="sim-add-item-inline">
                        <input
                          className="sim-add-item-input"
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          placeholder="Item name..."
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleManualAddItem();
                            if (e.key === 'Escape') setShowAddItem(false);
                          }}
                          autoFocus
                        />
                        <div className="sim-add-item-actions">
                          <button className="sim-btn-small" onClick={handleManualAddItem}>
                            Add
                          </button>
                          <button className="sim-btn-small" onClick={() => setShowAddItem(false)}>
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className="sim-user-card sim-add-item-card"
                        onClick={() => setShowAddItem(true)}
                      >
                        <div className="sim-user-avatar sim-add-item-avatar">+</div>
                        <div className="sim-user-info">
                          <span className="sim-user-name">Add Item</span>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </>
            ) : (
              <>
                {history.length === 0 ? (
                  <div className="sim-history-empty">
                    <p>No past simulations yet.</p>
                    <p className="sim-panel-hint">Run a simulation and it will appear here.</p>
                  </div>
                ) : (
                  <div className="sim-history-list">
                    {history.map((h) => (
                      <div
                        key={h.id}
                        className="sim-history-card"
                        onClick={() => viewHistory(h)}
                      >
                        <div className="sim-history-goal">{h.goal || 'No goal'}</div>
                        <div className="sim-history-meta">
                          {new Date(h.date).toLocaleDateString()} &middot;{' '}
                          {h.scores?.length || 0} pairing{(h.scores?.length || 0) !== 1 ? 's' : ''}
                        </div>
                        <button
                          className="sim-history-delete"
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteHistoryItem(h.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ═══ CENTER PANEL ═══ */}
      <div className="sim-center-panel">
        {/* Chat input at the top */}
        {phase === 'setup' && (
          <div className="sim-chat-bar sim-chat-bar-top">
            <input
              className="sim-chat-input"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Describe your simulation scenario..."
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSubmit(chatInput);
                }
              }}
              disabled={assistLoading}
            />
            <button
              className={`sim-voice-btn ${isRecording ? 'recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={assistLoading}
            >
              <div className="sim-voice-icon" />
            </button>
            <button
              className="sim-send-btn"
              onClick={() => handleChatSubmit(chatInput)}
              disabled={!chatInput.trim() || assistLoading}
            >
              SEND
            </button>
          </div>
        )}

        {pairingInfo && <div className="sim-pairing-info">{pairingInfo}</div>}

        <div
          ref={worldRef}
          className={`sim-world ${phase === 'setup' ? 'droppable' : ''} ${(draggingItemId != null || draggingParticipantId != null) ? 'dragging-item' : ''}`}
          onDrop={phase === 'setup' ? handleWorldDrop : undefined}
          onDragOver={phase === 'setup' ? handleWorldDragOver : undefined}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className={`sim-world-item ${phase === 'setup' ? 'draggable' : ''} ${draggingItemId === item.id ? 'is-dragging' : ''}`}
              style={{ left: item.x, top: item.y }}
              onMouseDown={(e) => handleItemMouseDown(e, item.id)}
            >
              <span>{item.name}</span>
              {phase === 'setup' && (
                <button
                  className="sim-item-remove"
                  onClick={(e) => { e.stopPropagation(); removeItem(item.id); }}
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {phase === 'setup' &&
            participants.map((p) => (
              <div
                key={p.userId}
                className={`sim-world-agent agent-primary setup-agent ${draggingParticipantId === p.userId ? 'is-dragging' : ''}`}
                style={{ left: p.position.x, top: p.position.y }}
                onMouseDown={(e) => handleParticipantMouseDown(e, p.userId)}
                title="Drag to move · Click to remove"
              >
                <div className="sim-agent-dot" />
                <span className="sim-agent-label">{p.bitName}</span>
              </div>
            ))}

          {phase !== 'setup' &&
            Object.entries(agentPositions).map(([role, pos]) => (
              <div
                key={role}
                className={`sim-world-agent ${role === 'agent2' ? 'agent-accent' : 'agent-primary'}`}
                style={{ left: pos.x, top: pos.y }}
              >
                <div className="sim-agent-dot" />
              </div>
            ))}

          {phase === 'setup' && items.length === 0 && participants.length === 0 && (
            <div className="sim-drop-hint">
              Drop agents here or use the chat to set up a scene
            </div>
          )}
        </div>

        {goal && <div className="sim-goal-display">GOAL: {goal}</div>}

        {phase === 'setup' && simMode && (
          <div className="sim-mode-indicator">
            {simMode === 'all'
              ? 'MODE: 1-on-1 with all users'
              : `MODE: Selected participants (${participants.length} in world)`}
          </div>
        )}

        {phase === 'setup' && (goal || items.length > 0 || participants.length > 0) && (
          <button
            className="sim-start-btn"
            onClick={() => {
              if (!goal) {
                setChatMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    text: "Set a goal first! Tell me what you're looking for (e.g. \"I want to find a study buddy\").",
                  },
                ]);
                return;
              }
              const useAll = simMode === 'all';
              if (!useAll && participants.length < 1) {
                setChatMessages((prev) => [
                  ...prev,
                  {
                    role: 'assistant',
                    text: 'Add some participants first! Drag agents from the left panel into the world, or ask me to set it up.',
                  },
                ]);
                return;
              }
              startSimulation(useAll, items, participants, goal);
            }}
          >
            START SIMULATION
          </button>
        )}
      </div>

      {/* ═══ RIGHT PANEL ═══ */}
      <div className="sim-right-panel">
        <div className="sim-right-header">
          <h3 className="sim-panel-title">
            {phase === 'setup'
              ? 'ASSISTANT'
              : phase === 'running'
                ? `LIVE CONVERSATION \u2014 TURN ${turnCount}/${MAX_TURNS}`
                : 'CONVERSATION LOG'}
          </h3>
          {phase === 'running' && (
            <button
              className="sim-stop-btn"
              onClick={() => {
                abortRef.current = true;
                if (abortControllerRef.current) {
                  abortControllerRef.current.abort();
                }
                // Failsafe: if the loop isn't running (e.g. restored ghost session),
                // the abort won't trigger a phase change. Force it after a short delay.
                setTimeout(() => {
                  setPhase((current) => {
                    if (current === 'running') {
                      setThinkingAgent(null);
                      setPairingInfo('');
                      return liveMessages.length > 0 ? 'results' : 'setup';
                    }
                    return current;
                  });
                }, 500);
              }}
            >
              STOP
            </button>
          )}
        </div>

        {phase === 'setup' ? (
          <div className="sim-chat-scroll">
            {chatMessages.map((msg, i) => (
              <div key={i} className={`sim-chat-msg ${msg.role}`}>
                <span className="sim-chat-author">
                  {msg.role === 'user' ? 'YOU' : 'ASSISTANT'}
                </span>
                <p className="sim-chat-text">{msg.text}</p>
              </div>
            ))}
            {assistLoading && (
              <div className="sim-chat-msg assistant">
                <span className="sim-chat-author">ASSISTANT</span>
                <div className="sim-typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            )}
            {simError && (
              <div className="sim-chat-msg assistant">
                <span className="sim-chat-author">SYSTEM</span>
                <p className="sim-chat-text" style={{ color: 'var(--accent)' }}>{simError}</p>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
        ) : (
          <div className="sim-live-scroll" ref={transcriptRef}>
            {liveMessages.length === 0 && phase === 'running' && (
              <div className="sim-live-empty">
                <div className="sim-typing-dots" style={{ justifyContent: 'center' }}>
                  <span />
                  <span />
                  <span />
                </div>
                <p>Agents are thinking...</p>
              </div>
            )}
            {liveMessages.map((msg, i) => (
              <div
                key={i}
                className={`sim-live-msg ${msg.isNarrative ? 'narrative' : ''}`}
              >
                {msg.speaker && (
                  <span className="sim-live-author">{msg.speaker}</span>
                )}
                <p className="sim-live-text">{msg.text}</p>
              </div>
            ))}
            {thinkingAgent && phase === 'running' && (
              <div className="sim-live-thinking">
                <div className="sim-typing-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="sim-thinking-label">{thinkingAgent}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ CHAT BAR (non-setup phases) ═══ */}
      {phase !== 'setup' && (
        <div className="sim-chat-bar">
          {phase === 'running' && (
            <div className="sim-progress-bar">
              <div className="sim-progress-fill" style={{ width: `${(turnCount / MAX_TURNS) * 100}%` }} />
            </div>
          )}
          <input
            className="sim-chat-input"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder={
              phase === 'running'
                ? 'Simulation in progress...'
                : 'Start a new simulation...'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleChatSubmit(chatInput);
              }
            }}
            disabled={assistLoading || phase === 'running'}
          />
          <button
            className={`sim-voice-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={assistLoading || phase === 'running'}
          >
            <div className="sim-voice-icon" />
          </button>
          <button
            className="sim-send-btn"
            onClick={() => handleChatSubmit(chatInput)}
            disabled={!chatInput.trim() || assistLoading || phase === 'running'}
          >
            SEND
          </button>
        </div>
      )}
    </div>
  );
}
