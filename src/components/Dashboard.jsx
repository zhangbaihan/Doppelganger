import { useState, useEffect, useRef } from 'react';
import SimulationConfig from './SimulationConfig';
import SimulationViewer from './SimulationViewer';

const PROMPTS = [
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

const SCORE_DOMAINS = [
  { key: 'identity_resolution', label: 'Identity Resolution' },
  { key: 'behavioral_specificity', label: 'Behavioral Specificity' },
  { key: 'emotional_resolution', label: 'Emotional Resolution' },
  { key: 'social_pattern_clarity', label: 'Social Pattern Clarity' },
];

const TABS = [
  { id: 'train', label: 'TRAIN' },
  { id: 'data', label: 'TRAINING DATA' },
  { id: 'sim', label: 'SIMULATION' },
];

const CHAT_MODES = [
  { id: 'freestyle', label: 'CONVERSATION', desc: 'Chat with Bit — back and forth' },
  { id: 'training', label: 'YAP SESH', desc: 'Talk about yourself — Bit takes notes' },
];

const PROFILE_FIELDS = [
  { key: 'age', label: 'AGE' },
  { key: 'height', label: 'HEIGHT' },
  { key: 'gender_identity', label: 'GENDER IDENTITY' },
  { key: 'race', label: 'RACE' },
  { key: 'sexual_orientation', label: 'SEXUAL ORIENTATION' },
];

export default function Dashboard({ token, user, onUserUpdate, onLogout }) {
  const [tab, setTab] = useState('train');
  const [chatMode, setChatMode] = useState('training'); // 'freestyle' | 'training'
  const [messages, setMessages] = useState([]);
  const [allTrainingData, setAllTrainingData] = useState([]);
  const [allFreestyleData, setAllFreestyleData] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState(null);
  const [showPrompts, setShowPrompts] = useState(false);
  const [expandedScore, setExpandedScore] = useState(null);
  const [confidenceScores, setConfidenceScores] = useState(
    user.confidence_scores || {
      identity_resolution: 0,
      behavioral_specificity: 0,
      emotional_resolution: 0,
      social_pattern_clarity: 0,
    }
  );
  const [confidenceReasoning, setConfidenceReasoning] = useState(
    user.confidence_reasoning?.reasoning || null
  );
  const [confidenceSuggestions, setConfidenceSuggestions] = useState(
    user.confidence_reasoning?.suggestions || null
  );
  const [knowledgeBase, setKnowledgeBase] = useState(
    user.knowledge_base || null
  );
  const [dataView, setDataView] = useState('kb');
  const [rawTranscriptType, setRawTranscriptType] = useState('training'); // 'freestyle' | 'training'
  const [conversationStarterPrompt, setConversationStarterPrompt] = useState(null); // Bit's first message when conversation is empty
  const [savedTranscriptsFreestyle, setSavedTranscriptsFreestyle] = useState([]);
  const [savedTranscriptsTraining, setSavedTranscriptsTraining] = useState([]);
  const [openedTranscript, setOpenedTranscript] = useState(null); // { id, name, type, messages }

  // Editing states
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({
    name: user.name || '',
    ...(user.profile_data || {}),
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [editingKbEntry, setEditingKbEntry] = useState(null); // { cat, sub, idx }
  const [kbEditValue, setKbEditValue] = useState('');
  const [addingKbEntry, setAddingKbEntry] = useState(null); // { cat, sub }
  const [kbAddValue, setKbAddValue] = useState('');

  // Simulation state
  const [simulations, setSimulations] = useState([]);
  const [selectedSimulationId, setSelectedSimulationId] = useState(null);
  const [showSimConfig, setShowSimConfig] = useState(false);
  const [simRunning, setSimRunning] = useState(false);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const chatEndRef = useRef(null);

  /* ── Load chat history on mount and when chat mode changes ──── */

  useEffect(() => {
    loadHistory();
  }, [chatMode]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, conversationStarterPrompt]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  async function loadHistory() {
    try {
      const type = chatMode === 'freestyle' ? 'freestyle' : 'training';
      const res = await fetch(`/api/chat/history?type=${type}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (chatMode === 'freestyle') {
        const history = data.conversations.flatMap((c) => [
          ...(c.user_message ? [{ role: 'user', text: c.user_message }] : []),
          ...(c.agent_response ? [{ role: 'assistant', text: c.agent_response }] : []),
        ]);
        setMessages(history);
        if (history.length === 0) {
          setConversationStarterPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);
        } else {
          setConversationStarterPrompt(null);
        }
      } else {
        setMessages(
          data.conversations.map((c) => ({ role: 'user', text: c.user_message }))
        );
      }
      if (chatMode === 'training') {
        setAllTrainingData(data.conversations);
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  /* ── Save helpers ──────────────────────────────────────────────── */

  async function saveUpdate(body) {
    const res = await fetch('/api/profile/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Save failed');
    const data = await res.json();
    onUserUpdate(data.user);
    return data.user;
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const { name, ...profileFields } = profileDraft;
      const updated = await saveUpdate({
        name: name.trim(),
        profileData: profileFields,
      });
      setEditingProfile(false);
    } catch (err) {
      setError('Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  }

  function updateKbEntry(cat, sub, idx, newValue) {
    const kb = JSON.parse(JSON.stringify(knowledgeBase));
    if (sub) {
      kb[cat][sub][idx] = newValue;
    } else {
      kb[cat][idx] = newValue;
    }
    setKnowledgeBase(kb);
    saveUpdate({ knowledgeBase: kb }).catch(() => setError('Failed to save'));
  }

  function deleteKbEntry(cat, sub, idx) {
    const kb = JSON.parse(JSON.stringify(knowledgeBase));
    if (sub) {
      kb[cat][sub].splice(idx, 1);
    } else {
      kb[cat].splice(idx, 1);
    }
    setKnowledgeBase(kb);
    saveUpdate({ knowledgeBase: kb }).catch(() => setError('Failed to save'));
  }

  function addKbEntry(cat, sub, value) {
    if (!value.trim()) return;
    const kb = JSON.parse(JSON.stringify(knowledgeBase));
    if (sub) {
      if (!kb[cat][sub]) kb[cat][sub] = [];
      kb[cat][sub].push(value.trim());
    } else {
      if (!kb[cat]) kb[cat] = [];
      kb[cat].push(value.trim());
    }
    setKnowledgeBase(kb);
    setAddingKbEntry(null);
    setKbAddValue('');
    saveUpdate({ knowledgeBase: kb }).catch(() => setError('Failed to save'));
  }

  /* ── Simulation helpers ──────────────────────────────────────── */

  async function loadSimulations() {
    try {
      const res = await fetch('/api/simulations', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSimulations(data.simulations || []);
      }
    } catch (err) {
      console.error('Failed to load simulations:', err);
    }
  }

  async function handleSimulationCreated(simulationId) {
    setShowSimConfig(false);
    setSelectedSimulationId(simulationId);
    setSimRunning(true);

    try {
      const res = await fetch(`/api/simulations/${simulationId}/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Simulation failed');
      }
    } catch (err) {
      console.error('Simulation run error:', err);
      setError(err.message || 'Simulation failed');
    } finally {
      setSimRunning(false);
      loadSimulations();
    }
  }

  async function handleDeleteSimulation(simulationId, e) {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/simulations/${simulationId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        loadSimulations();
        if (selectedSimulationId === simulationId) {
          setSelectedSimulationId(null);
        }
      }
    } catch (err) {
      console.error('Delete simulation error:', err);
    }
  }

  // Load simulations when switching to sim tab
  useEffect(() => {
    if (tab === 'sim') loadSimulations();
  }, [tab]);

  // Load saved transcripts (list only) when on Data tab
  async function loadSavedTranscripts() {
    try {
      const [trainRes, freeRes] = await Promise.all([
        fetch('/api/transcripts?type=training', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/transcripts?type=freestyle', { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (trainRes.ok) {
        const data = await trainRes.json();
        setSavedTranscriptsTraining(data.transcripts || []);
      }
      if (freeRes.ok) {
        const data = await freeRes.json();
        setSavedTranscriptsFreestyle(data.transcripts || []);
      }
    } catch (err) {
      console.error('Failed to load saved transcripts:', err);
    }
  }

  async function openTranscript(id) {
    try {
      const res = await fetch(`/api/transcripts/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      setOpenedTranscript({
        id: data.id,
        name: data.name,
        type: data.type,
        messages: data.messages || [],
      });
    } catch (err) {
      console.error('Failed to open transcript:', err);
    }
  }

  async function handleClearAndSave() {
    if (messages.length === 0 || isProcessing) return;
    try {
      const res = await fetch('/api/transcripts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages, type: chatMode }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save');
      }
      setMessages([]);
      if (chatMode === 'freestyle') {
        setConversationStarterPrompt(PROMPTS[Math.floor(Math.random() * PROMPTS.length)]);
      }
      setError(null);
      loadSavedTranscripts();
    } catch (err) {
      console.error('Clear & Save error:', err);
      setError(err.message || 'Failed to save transcript');
    }
  }

  useEffect(() => {
    if (tab === 'data') loadSavedTranscripts();
  }, [tab]);

  useEffect(() => {
    if (dataView !== 'raw') setOpenedTranscript(null);
  }, [dataView]);

  /* ── Recording ───────────────────────────────────────────────── */

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        audioBitsPerSecond: 32000,
      });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach((t) => t.stop());
        sendAudio(blob);
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone error:', err);
      setError('Microphone access denied');
    }
  }

  function stopRecording() {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording'
    ) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  /* ── Send audio to backend ───────────────────────────────────── */

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function sendMessage(body) {
    setIsProcessing(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to process');
      }

      const data = await res.json();

      if (data.type === 'freestyle') {
        setMessages((prev) => {
          const updated = [...prev];
          // If this is the first message and Bit started with a prompt, include it
          if (prev.length === 0 && conversationStarterPrompt) {
            updated.push({ role: 'assistant', text: conversationStarterPrompt });
          }
          updated.push({ role: 'user', text: data.userMessage });
          updated.push({ role: 'assistant', text: data.agentResponse || '' });
          return updated;
        });
        setConversationStarterPrompt(null);
        if (data.confidenceScores) setConfidenceScores(data.confidenceScores);
        if (data.confidenceReasoning) setConfidenceReasoning(data.confidenceReasoning);
        if (data.confidenceSuggestions) setConfidenceSuggestions(data.confidenceSuggestions);
        if (data.knowledgeBase) setKnowledgeBase(data.knowledgeBase);
      } else {
        setMessages((prev) => [...prev, { role: 'user', text: data.userMessage }]);
        setConfidenceScores(data.confidenceScores || confidenceScores);
        setConfidenceReasoning(data.confidenceReasoning);
        setConfidenceSuggestions(data.confidenceSuggestions);
        if (data.knowledgeBase) setKnowledgeBase(data.knowledgeBase);
        setAllTrainingData((prev) => [
          ...prev,
          {
            user_message: data.userMessage,
            agent_response: '',
            created_at: new Date().toISOString(),
          },
        ]);
      }
    } catch (err) {
      console.error('Send error:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setIsProcessing(false);
    }
  }

  async function sendAudio(blob) {
    const base64 = await blobToBase64(blob);
    const body = { audio: base64, type: chatMode };
    if (chatMode === 'freestyle' && messages.length === 0 && conversationStarterPrompt) {
      body.initialPrompt = conversationStarterPrompt;
    }
    await sendMessage(body);
  }

  function handleSendText() {
    const trimmed = inputText.trim();
    if (!trimmed || isProcessing) return;
    setInputText('');
    const body = { text: trimmed, type: chatMode };
    if (chatMode === 'freestyle' && messages.length === 0 && conversationStarterPrompt) {
      body.initialPrompt = conversationStarterPrompt;
    }
    sendMessage(body);
  }

  /* ── KB item renderer ────────────────────────────────────────── */

  function renderKbItems(items, category, subKey) {
    if (!Array.isArray(items) || items.length === 0) return null;

    const isAddingHere =
      addingKbEntry &&
      addingKbEntry.cat === category &&
      addingKbEntry.sub === subKey;

    return (
      <div className="kb-subcategory">
        {subKey && (
          <span className="kb-sub-label">{subKey.replace(/_/g, ' ')}</span>
        )}
        <ul className="kb-items">
          {items.map((item, j) => {
            const isEditing =
              editingKbEntry &&
              editingKbEntry.cat === category &&
              editingKbEntry.sub === subKey &&
              editingKbEntry.idx === j;

            return (
              <li key={j} className="kb-item">
                {isEditing ? (
                  <div className="kb-edit-row">
                    <input
                      className="kb-edit-input"
                      value={kbEditValue}
                      onChange={(e) => setKbEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          updateKbEntry(category, subKey, j, kbEditValue);
                          setEditingKbEntry(null);
                        }
                        if (e.key === 'Escape') setEditingKbEntry(null);
                      }}
                      autoFocus
                    />
                    <button
                      className="kb-action-btn save"
                      onClick={() => {
                        updateKbEntry(category, subKey, j, kbEditValue);
                        setEditingKbEntry(null);
                      }}
                    >
                      ✓
                    </button>
                    <button
                      className="kb-action-btn cancel"
                      onClick={() => setEditingKbEntry(null)}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="kb-item-row">
                    <span className="kb-item-text">{item}</span>
                    <div className="kb-item-actions">
                      <button
                        className="kb-action-btn edit"
                        onClick={() => {
                          setEditingKbEntry({ cat: category, sub: subKey, idx: j });
                          setKbEditValue(item);
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="kb-action-btn delete"
                        onClick={() => deleteKbEntry(category, subKey, j)}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {isAddingHere ? (
          <div className="kb-add-row">
            <input
              className="kb-edit-input"
              value={kbAddValue}
              onChange={(e) => setKbAddValue(e.target.value)}
              placeholder="New entry..."
              onKeyDown={(e) => {
                if (e.key === 'Enter') addKbEntry(category, subKey, kbAddValue);
                if (e.key === 'Escape') {
                  setAddingKbEntry(null);
                  setKbAddValue('');
                }
              }}
              autoFocus
            />
            <button
              className="kb-action-btn save"
              onClick={() => addKbEntry(category, subKey, kbAddValue)}
            >
              ✓
            </button>
            <button
              className="kb-action-btn cancel"
              onClick={() => {
                setAddingKbEntry(null);
                setKbAddValue('');
              }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            className="kb-add-btn"
            onClick={() => {
              setAddingKbEntry({ cat: category, sub: subKey });
              setKbAddValue('');
            }}
          >
            + ADD
          </button>
        )}
      </div>
    );
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="dashboard">
      {error && <div className="error-toast">{error}</div>}

      {/* Header with logout */}
      <div className="dashboard-header">
        <button className="logout-btn" onClick={onLogout}>LOGOUT</button>
      </div>

      {/* Bit character */}
      <div className="bit-section">
        <div className="bit-shape dashboard-bit trained">
          <div className="bit-inner" />
        </div>
        <h2 className="bit-name">{user.bit_name}</h2>
      </div>

      {/* Tab navigation */}
      <div className="tab-nav">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            className={`tab-btn ${tab === id ? 'active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ═══ TRAIN TAB ═══ */}
      {tab === 'train' && (
        <>
          <div className="confidence-section">
            <h3 className="section-title">CONFIDENCE SCORES</h3>
            <p className="section-desc">
              How well {user.bit_name} can predict you:
            </p>
            <div className="scores-grid">
              {SCORE_DOMAINS.map(({ key, label }) => (
                <div key={key} className="score-item">
                  <div
                    className="score-header"
                    onClick={() =>
                      setExpandedScore(expandedScore === key ? null : key)
                    }
                  >
                    <div className="score-label">{label}</div>
                    <div className="score-value-row">
                      <span className="score-value">
                        {confidenceScores[key] || 0}%
                      </span>
                      <span className="score-why">
                        {expandedScore === key ? '\u25B2' : 'WHY?'}
                      </span>
                    </div>
                  </div>
                  <div className="score-bar-bg">
                    <div
                      className="score-bar-fill"
                      style={{ width: `${confidenceScores[key] || 0}%` }}
                    />
                  </div>
                  {expandedScore === key && (
                    <div className="score-detail">
                      {confidenceReasoning && confidenceReasoning[key] && (
                        <div className="score-reasoning">
                          {confidenceReasoning[key]}
                        </div>
                      )}
                      {confidenceSuggestions && confidenceSuggestions[key] && (
                        <div className="score-suggestion">
                          <span className="suggestion-label">TRY:</span>{' '}
                          {confidenceSuggestions[key]}
                        </div>
                      )}
                      {!confidenceReasoning && !confidenceSuggestions && (
                        <div className="score-reasoning">
                          Record a training session to see reasoning here.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="chat-mode-toggle">
            {CHAT_MODES.map(({ id, label, desc }) => (
              <button
                key={id}
                className={`chat-mode-btn ${chatMode === id ? 'active' : ''}`}
                onClick={() => setChatMode(id)}
              >
                <span className="chat-mode-label">{label}</span>
                <span className="chat-mode-desc">{desc}</span>
              </button>
            ))}
          </div>

          {chatMode === 'training' && (
            <div className="prompts-section">
              <button
                className="prompts-toggle"
                onClick={() => setShowPrompts((p) => !p)}
              >
                <span className="section-title" style={{ margin: 0 }}>
                  CONVERSATION STARTERS
                </span>
                <span className="prompts-arrow">
                  {showPrompts ? '\u25B2' : '\u25BC'}
                </span>
              </button>
              {showPrompts && (
                <ul className="prompts-list">
                  {PROMPTS.map((p, i) => (
                    <li key={i} className="prompt-item">
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="chat-section">
            <div className="chat-messages">
              {chatMode === 'freestyle' && messages.length === 0 && conversationStarterPrompt && (
                <div className="chat-msg agent">
                  <span className="msg-author">{user.bit_name?.toUpperCase()}</span>
                  <p className="msg-text">{conversationStarterPrompt}</p>
                </div>
              )}
              {messages.length === 0 && !(chatMode === 'freestyle' && conversationStarterPrompt) && (
                <div className="chat-empty">
                  {chatMode === 'freestyle'
                    ? `Hit record and chat with ${user.bit_name}. You can talk about anything — ${user.bit_name} will reply.`
                    : `Hit record and start talking to ${user.bit_name}.\nTalk about anything — your day, your habits, your opinions.\n${user.bit_name} is listening and taking notes.`}
                </div>
              )}
              {messages.map((msg, i) => (
                <div key={i} className={`chat-msg ${msg.role === 'assistant' ? 'agent' : 'user'}`}>
                  <span className="msg-author">{msg.role === 'assistant' ? user.bit_name?.toUpperCase() : 'YOU'}</span>
                  <p className="msg-text">{msg.text}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
          </div>

          <div className="record-section">
            {isProcessing ? (
              <div className="processing-indicator">
                <div className="processing-dots">
                  <span />
                  <span />
                  <span />
                </div>
                <span className="processing-text">Processing...</span>
              </div>
            ) : (
              <>
                <div className="chat-input-row">
                  <button
                    className={`record-icon-btn ${isRecording ? 'recording' : ''}`}
                    onClick={isRecording ? stopRecording : startRecording}
                    title={isRecording ? 'Stop recording' : 'Record audio'}
                  >
                    {isRecording ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
                    )}
                  </button>
                  <input
                    type="text"
                    className="chat-text-input"
                    placeholder="Type a message..."
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendText();
                      }
                    }}
                    disabled={isProcessing}
                  />
                  <button
                    type="button"
                    className="chat-send-btn"
                    onClick={handleSendText}
                    disabled={isProcessing || !inputText.trim()}
                  >
                    SEND
                  </button>
                </div>
                <button
                  type="button"
                  className="clear-save-btn"
                  onClick={handleClearAndSave}
                  disabled={messages.length === 0}
                  title="Save this conversation and start fresh"
                >
                  CLEAR & SAVE
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ═══ TRAINING DATA TAB ═══ */}
      {tab === 'data' && (
        <>
          {/* Editable Profile */}
          <div className="profile-section">
            <div className="section-header-row">
              <h3 className="section-title" style={{ margin: 0 }}>PROFILE</h3>
              {!editingProfile ? (
                <button
                  className="inline-edit-btn"
                  onClick={() => {
                    setProfileDraft({
                      name: user.name || '',
                      ...(user.profile_data || {}),
                    });
                    setEditingProfile(true);
                  }}
                >
                  EDIT
                </button>
              ) : (
                <div className="inline-edit-actions">
                  <button
                    className="inline-edit-btn save"
                    onClick={saveProfile}
                    disabled={savingProfile}
                  >
                    {savingProfile ? '...' : 'SAVE'}
                  </button>
                  <button
                    className="inline-edit-btn cancel"
                    onClick={() => setEditingProfile(false)}
                  >
                    CANCEL
                  </button>
                </div>
              )}
            </div>
            {editingProfile ? (
              <div className="profile-edit-grid">
                <div className="profile-edit-field">
                  <label className="profile-label">NAME</label>
                  <input
                    className="profile-edit-input"
                    value={profileDraft.name}
                    onChange={(e) =>
                      setProfileDraft((p) => ({ ...p, name: e.target.value }))
                    }
                  />
                </div>
                {PROFILE_FIELDS.map(({ key, label }) => (
                  <div key={key} className="profile-edit-field">
                    <label className="profile-label">{label}</label>
                    <input
                      className="profile-edit-input"
                      value={profileDraft[key] || ''}
                      onChange={(e) =>
                        setProfileDraft((p) => ({
                          ...p,
                          [key]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="profile-grid">
                <div className="profile-item">
                  <span className="profile-label">NAME</span>
                  <span className="profile-value">{user.name}</span>
                </div>
                {PROFILE_FIELDS.map(({ key, label }) => {
                  const val = user.profile_data?.[key];
                  if (!val) return null;
                  return (
                    <div key={key} className="profile-item">
                      <span className="profile-label">{label}</span>
                      <span className="profile-value">{val}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sub-nav */}
          <div className="data-sub-nav">
            <button
              className={`data-sub-btn ${dataView === 'kb' ? 'active' : ''}`}
              onClick={() => setDataView('kb')}
            >
              KNOWLEDGE BASE
            </button>
            <button
              className={`data-sub-btn ${dataView === 'raw' ? 'active' : ''}`}
              onClick={() => setDataView('raw')}
            >
              RAW TRANSCRIPTS
            </button>
          </div>

          {/* Editable Knowledge Base */}
          {dataView === 'kb' && (
            <div className="training-data-section">
              {!knowledgeBase ? (
                <p className="section-desc">
                  No structured knowledge yet. Record your first training session!
                </p>
              ) : (
                <div className="kb-grid">
                  {Object.entries(knowledgeBase).map(([category, content]) => {
                    const isNested =
                      typeof content === 'object' && !Array.isArray(content);
                    const entries = isNested
                      ? Object.entries(content)
                      : [['', content]];

                    return (
                      <div key={category} className="kb-category">
                        <h4 className="kb-category-title">
                          {category.replace(/_/g, ' ')}
                        </h4>
                        {entries.map(([subKey, items]) => {
                          if (!Array.isArray(items)) return null;
                          // Show even empty arrays so user can add entries
                          return (
                            <div key={subKey || '_root'}>
                              {items.length > 0
                                ? renderKbItems(items, category, subKey || '')
                                : (() => {
                                    const isAddingHere =
                                      addingKbEntry &&
                                      addingKbEntry.cat === category &&
                                      addingKbEntry.sub === (subKey || '');
                                    return (
                                      <div className="kb-subcategory">
                                        {subKey && (
                                          <span className="kb-sub-label">
                                            {subKey.replace(/_/g, ' ')}
                                          </span>
                                        )}
                                        {isAddingHere ? (
                                          <div className="kb-add-row">
                                            <input
                                              className="kb-edit-input"
                                              value={kbAddValue}
                                              onChange={(e) =>
                                                setKbAddValue(e.target.value)
                                              }
                                              placeholder="New entry..."
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter')
                                                  addKbEntry(
                                                    category,
                                                    subKey || '',
                                                    kbAddValue
                                                  );
                                                if (e.key === 'Escape') {
                                                  setAddingKbEntry(null);
                                                  setKbAddValue('');
                                                }
                                              }}
                                              autoFocus
                                            />
                                            <button
                                              className="kb-action-btn save"
                                              onClick={() =>
                                                addKbEntry(
                                                  category,
                                                  subKey || '',
                                                  kbAddValue
                                                )
                                              }
                                            >
                                              ✓
                                            </button>
                                            <button
                                              className="kb-action-btn cancel"
                                              onClick={() => {
                                                setAddingKbEntry(null);
                                                setKbAddValue('');
                                              }}
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            className="kb-add-btn"
                                            onClick={() => {
                                              setAddingKbEntry({
                                                cat: category,
                                                sub: subKey || '',
                                              });
                                              setKbAddValue('');
                                            }}
                                          >
                                            + ADD
                                          </button>
                                        )}
                                      </div>
                                    );
                                  })()}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Saved Transcripts: list of "files" + open one to view */}
          {dataView === 'raw' && (
            <div className="training-data-section transcripts-page">
              <div className="raw-transcript-sub-nav">
                <button
                  className={`data-sub-btn ${rawTranscriptType === 'freestyle' ? 'active' : ''}`}
                  onClick={() => {
                    setRawTranscriptType('freestyle');
                    setOpenedTranscript(null);
                  }}
                >
                  CONVERSATION
                </button>
                <button
                  className={`data-sub-btn ${rawTranscriptType === 'training' ? 'active' : ''}`}
                  onClick={() => {
                    setRawTranscriptType('training');
                    setOpenedTranscript(null);
                  }}
                >
                  TRAINING
                </button>
              </div>
              {openedTranscript ? (
                <div className="transcript-detail">
                  <div className="transcript-detail-header">
                    <button type="button" className="transcript-back-btn" onClick={() => setOpenedTranscript(null)}>
                      ← BACK TO LIST
                    </button>
                    <h4 className="transcript-detail-title">{openedTranscript.name}</h4>
                  </div>
                  <div className="transcript-detail-messages">
                    {openedTranscript.messages.map((msg, i) => (
                      <div key={i} className={`chat-msg ${msg.role === 'assistant' ? 'agent' : 'user'}`}>
                        <span className="msg-author">{msg.role === 'assistant' ? user.bit_name?.toUpperCase() : 'YOU'}</span>
                        <p className="msg-text">{msg.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <p className="section-desc">
                    {rawTranscriptType === 'freestyle'
                      ? (savedTranscriptsFreestyle.length === 0
                          ? 'No saved conversations yet. Use "Clear & Save" on the Train tab to save one.'
                          : `${savedTranscriptsFreestyle.length} saved conversation${savedTranscriptsFreestyle.length !== 1 ? 's' : ''}`)
                      : (savedTranscriptsTraining.length === 0
                          ? 'No saved training sessions yet. Use "Clear & Save" on the Train tab to save one.'
                          : `${savedTranscriptsTraining.length} saved training session${savedTranscriptsTraining.length !== 1 ? 's' : ''}`)}
                  </p>
                  <div className="transcript-file-list">
                    {(rawTranscriptType === 'freestyle' ? savedTranscriptsFreestyle : savedTranscriptsTraining).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className="transcript-file-row"
                        onClick={() => openTranscript(t.id)}
                      >
                        <span className="transcript-file-name">{t.name}</span>
                        <span className="transcript-file-date">
                          {new Date(t.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══ SIMULATION TAB ═══ */}
      {tab === 'sim' && (
        <>
          {showSimConfig ? (
            <>
              <SimulationConfig
                token={token}
                currentUser={user}
                onSimulationCreated={handleSimulationCreated}
              />
              <button
                className="back-btn"
                onClick={() => setShowSimConfig(false)}
              >
                Back to Simulations
              </button>
            </>
          ) : selectedSimulationId ? (
            <>
              {simRunning ? (
                <div className="sim-running-indicator">
                  <div className="processing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="sim-running-text">
                    Running simulation... This may take a minute.
                  </p>
                </div>
              ) : (
                <SimulationViewer
                  token={token}
                  simulationId={selectedSimulationId}
                />
              )}
              <button
                className="back-btn"
                onClick={() => {
                  setSelectedSimulationId(null);
                  loadSimulations();
                }}
              >
                Back to Simulations
              </button>
            </>
          ) : (
            <div className="simulations-list">
              <div className="simulations-header">
                <h3 className="section-title" style={{ margin: 0 }}>
                  SIMULATIONS
                </h3>
                <button
                  className="config-submit-btn"
                  onClick={() => setShowSimConfig(true)}
                >
                  + NEW SIMULATION
                </button>
              </div>
              {simulations.length === 0 ? (
                <div className="simulations-empty">
                  <p>No simulations yet. Create one to get started!</p>
                </div>
              ) : (
                <div className="simulations-grid">
                  {simulations.map((sim) => (
                    <div
                      key={sim.id}
                      className="simulation-card"
                      onClick={() => {
                        setSelectedSimulationId(Number(sim.id));
                        setShowSimConfig(false);
                      }}
                    >
                      <div className="sim-card-header">
                        <h4>{sim.name || 'Untitled Simulation'}</h4>
                        <button
                          className="sim-delete-btn"
                          onClick={(e) =>
                            handleDeleteSimulation(Number(sim.id), e)
                          }
                          title="Delete simulation"
                        >
                          ×
                        </button>
                      </div>
                      <div className="sim-status">
                        Status:{' '}
                        <span className={`status-${sim.status}`}>
                          {sim.status}
                        </span>
                      </div>
                      <div className="sim-meta">
                        {sim.num_simulations} simulation
                        {Number(sim.num_simulations) !== 1 ? 's' : ''}
                      </div>
                      <div className="sim-date">
                        {new Date(sim.created_at).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
