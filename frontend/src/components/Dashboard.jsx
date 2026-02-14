import { useState, useEffect, useRef } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const INITIAL_QUESTIONS = [
  "What's your age?",
  'How do you identify in terms of gender?',
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

export default function Dashboard({ token, user, onUserUpdate }) {
  const [messages, setMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [questionsCovered, setQuestionsCovered] = useState(
    user.questions_covered || []
  );
  const [confidenceScores, setConfidenceScores] = useState(
    user.confidence_scores || {
      identity_resolution: 0,
      behavioral_specificity: 0,
      emotional_resolution: 0,
      social_pattern_clarity: 0,
    }
  );
  const [isTrained, setIsTrained] = useState(!!user.is_trained);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const chatEndRef = useRef(null);

  /* ── Load chat history on mount ──────────────────────────────── */

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (error) {
      const t = setTimeout(() => setError(null), 4000);
      return () => clearTimeout(t);
    }
  }, [error]);

  async function loadHistory() {
    try {
      const res = await fetch(`${API_URL}/api/chat/history`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = await res.json();
      const history = data.conversations.flatMap((c) => [
        { role: 'user', text: c.user_message },
        { role: 'agent', text: c.agent_response },
      ]);
      setMessages(history);
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  /* ── Recording ───────────────────────────────────────────────── */

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
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

      mediaRecorder.start();
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

  async function sendAudio(blob) {
    setIsProcessing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'recording.webm');

      const res = await fetch(`${API_URL}/api/chat/message`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to process');
      }

      const data = await res.json();

      setMessages((prev) => [
        ...prev,
        { role: 'user', text: data.userMessage },
        { role: 'agent', text: data.agentResponse },
      ]);

      setQuestionsCovered(data.questionsCovered);
      setConfidenceScores(data.confidenceScores);

      if (data.isTrained && !isTrained) {
        setIsTrained(true);
        onUserUpdate({ is_trained: 1 });
      }
    } catch (err) {
      console.error('Send error:', err);
      setError(err.message || 'Something went wrong');
    } finally {
      setIsProcessing(false);
    }
  }

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="dashboard">
      {error && <div className="error-toast">{error}</div>}

      {/* Bit character */}
      <div className="bit-section">
        <div
          className={`bit-shape dashboard-bit ${isTrained ? 'trained' : 'untrained'}`}
        >
          <div className="bit-inner" />
        </div>
        <h2 className="bit-name">{user.bit_name}</h2>
        {!isTrained && (
          <span className="status-badge untrained-badge">UNTRAINED</span>
        )}
      </div>

      {/* Training guide OR confidence scores */}
      {!isTrained ? (
        <div className="training-guide">
          <h3 className="section-title">TRAINING GUIDE</h3>
          <p className="section-desc">
            Tell {user.bit_name} about yourself. Cover these topics:
          </p>
          <ul className="questions-list">
            {INITIAL_QUESTIONS.map((q, i) => (
              <li
                key={i}
                className={`question-item ${questionsCovered.includes(i) ? 'covered' : ''}`}
              >
                <span className="question-check">
                  {questionsCovered.includes(i) ? '\u25C6' : '\u25C7'}
                </span>
                {q}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="confidence-section">
          <h3 className="section-title">CONFIDENCE SCORES</h3>
          <p className="section-desc">
            How well {user.bit_name} can predict you:
          </p>
          <div className="scores-grid">
            {SCORE_DOMAINS.map(({ key, label }) => (
              <div key={key} className="score-item">
                <div className="score-label">{label}</div>
                <div className="score-bar-bg">
                  <div
                    className="score-bar-fill"
                    style={{ width: `${confidenceScores[key] || 0}%` }}
                  />
                </div>
                <div className="score-value">
                  {confidenceScores[key] || 0}%
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Chat messages */}
      <div className="chat-section">
        <div className="chat-messages">
          {messages.length === 0 && (
            <div className="chat-empty">
              {!isTrained
                ? `Hit record and start talking to ${user.bit_name}.\nCover the training topics to get started.`
                : `Keep talking to ${user.bit_name} to improve confidence scores.`}
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`chat-msg ${msg.role}`}>
              <span className="msg-author">
                {msg.role === 'user' ? 'YOU' : user.bit_name.toUpperCase()}
              </span>
              <p className="msg-text">{msg.text}</p>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>
      </div>

      {/* Record button */}
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
          <button
            className={`record-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
          >
            <div className="record-icon" />
            <span>{isRecording ? 'STOP' : 'RECORD'}</span>
          </button>
        )}
      </div>
    </div>
  );
}
