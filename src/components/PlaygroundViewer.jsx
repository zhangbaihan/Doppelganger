import { useState, useEffect } from 'react';

export default function PlaygroundViewer({ token, user, onBack }) {
  const [worldState, setWorldState] = useState(null);
  const [myAgent, setMyAgent] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedInteraction, setSelectedInteraction] = useState(null);
  const [viewDate, setViewDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    loadPlaygroundData();
    const interval = setInterval(loadPlaygroundData, 10000);
    return () => clearInterval(interval);
  }, [viewDate]);

  async function loadPlaygroundData() {
    try {
      setError(null);
      const [stateRes, agentRes, interactionsRes] = await Promise.all([
        fetch('/api/playground/state', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch('/api/playground/my-agent', {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`/api/playground/interactions?date=${viewDate}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (stateRes.ok) {
        const stateData = await stateRes.json();
        setWorldState(stateData);
      }

      if (agentRes.ok) {
        const agentData = await agentRes.json();
        setMyAgent(agentData.agent);
      } else {
        setMyAgent(null);
      }

      if (interactionsRes.ok) {
        const interactionsData = await interactionsRes.json();
        setInteractions(interactionsData.interactions || []);
      }
    } catch (err) {
      console.error('Failed to load playground:', err);
      setError('Failed to load playground data');
    } finally {
      setLoading(false);
    }
  }

  function getTimeLabel(hour) {
    const h = Number(hour);
    if (h >= 5 && h < 12) return 'Morning';
    if (h >= 12 && h < 17) return 'Afternoon';
    if (h >= 17 && h < 21) return 'Evening';
    return 'Night';
  }

  function formatHour(hour) {
    const h = Number(hour);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:00 ${ampm}`;
  }

  function getInteractionLocation(interaction) {
    if (interaction.turns && interaction.turns.length > 0) {
      return interaction.turns[0].location_after || interaction.turns[0].location_before || 'Unknown';
    }
    return myAgent?.current_location || 'Unknown';
  }

  function getInteractionTranscript(interaction) {
    if (!interaction.conversations || interaction.conversations.length === 0) {
      return 'No conversation yet...';
    }
    return interaction.conversations
      .map((conv) => {
        const agentName = conv.agent_user_id === user.id ? myAgent?.agent_name || 'You' : 'Other';
        return `${agentName}: ${conv.message}`;
      })
      .join('\n');
  }

  if (loading) {
    return (
      <div className="pg-root">
        <div className="pg-loading">
          <div className="processing-dots">
            <span /><span /><span />
          </div>
          <p>Loading playground...</p>
        </div>
      </div>
    );
  }

  if (!myAgent) {
    return (
      <div className="pg-root">
        <div className="pg-topbar">
          <button className="pg-back-btn" onClick={onBack}>BACK</button>
          <h2 className="pg-title">PLAYGROUND</h2>
          <div />
        </div>
        <div className="pg-empty-state">
          <p>Your agent is being added to the playground...</p>
          {error && <div className="error-toast">{error}</div>}
        </div>
      </div>
    );
  }

  const worldConfig = worldState?.world?.world_config || {};
  const locations = worldConfig.locations || [];
  const agents = worldState?.agents || [];
  const currentHour = new Date().getHours();

  const sortedInteractions = [...interactions].sort(
    (a, b) => Number(a.interaction_hour) - Number(b.interaction_hour)
  );

  return (
    <div className="pg-root">
      {error && <div className="error-toast">{error}</div>}

      {/* Top bar */}
      <div className="pg-topbar">
        <button className="pg-back-btn" onClick={onBack}>BACK</button>
        <h2 className="pg-title">STANFORD CAMPUS</h2>
        <div className="pg-agent-badge">
          <span className="pg-agent-dot" />
          <span className="pg-agent-badge-name">{myAgent.agent_name}</span>
          <span className="pg-agent-badge-loc">{myAgent.current_location || 'Roaming'}</span>
        </div>
      </div>

      {/* Map */}
      <div className="pg-map-card">
        <div className="pg-map">
          {/* Grid lines for visual depth */}
          <div className="pg-map-grid" />

          {locations.map((loc, idx) => (
            <div
              key={idx}
              className="pg-location"
              style={{ left: `${(loc.x / 600) * 100}%`, top: `${(loc.y / 400) * 100}%` }}
              title={loc.description}
            >
              <div className="pg-loc-dot" />
              <span className="pg-loc-name">{loc.name}</span>
            </div>
          ))}

          {agents.map((agent, idx) => {
            const isMe = agent.user_id === user.id;
            return (
              <div
                key={idx}
                className={`pg-agent ${isMe ? 'pg-agent-me' : ''}`}
                style={{
                  left: `${(agent.position_x / 600) * 100}%`,
                  top: `${(agent.position_y / 400) * 100}%`,
                }}
                title={isMe ? 'You' : agent.agent_name}
              >
                <div className="pg-agent-pip" />
                {isMe && <span className="pg-agent-you-tag">YOU</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* Interactions */}
      <div className="pg-interactions-card">
        <div className="pg-interactions-header">
          <h3 className="pg-section-title">ACTIVITY LOG</h3>
          <input
            type="date"
            className="pg-date-input"
            value={viewDate}
            onChange={(e) => setViewDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]}
          />
        </div>

        {sortedInteractions.length === 0 ? (
          <div className="pg-empty-table">
            No interactions recorded for this date.
          </div>
        ) : (
          <div className="pg-table-wrap">
            <table className="pg-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Location</th>
                  <th>Status</th>
                  <th>Transcript</th>
                </tr>
              </thead>
              <tbody>
                {sortedInteractions.map((interaction) => {
                  const isSelected = selectedInteraction?.id === interaction.id;
                  return (
                    <tr
                      key={interaction.id}
                      className={isSelected ? 'pg-row-selected' : ''}
                      onClick={() => setSelectedInteraction(isSelected ? null : interaction)}
                    >
                      <td className="pg-td-hour">
                        <span className="pg-hour-text">{formatHour(interaction.interaction_hour)}</span>
                        <span className="pg-hour-period">{getTimeLabel(interaction.interaction_hour)}</span>
                      </td>
                      <td className="pg-td-location">{getInteractionLocation(interaction)}</td>
                      <td className="pg-td-status">
                        <span className={`pg-status-pill pg-status-${interaction.status}`}>
                          {interaction.status}
                        </span>
                        <span className="pg-turns-label">{interaction.turn_count}/10</span>
                      </td>
                      <td className="pg-td-transcript">
                        {getInteractionTranscript(interaction).substring(0, 120)}
                        {getInteractionTranscript(interaction).length > 120 && '...'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Expanded interaction detail */}
        {selectedInteraction && (
          <div className="pg-detail-panel">
            <div className="pg-detail-header">
              <div>
                <h4 className="pg-detail-title">
                  {formatHour(selectedInteraction.interaction_hour)} — {getTimeLabel(selectedInteraction.interaction_hour)}
                </h4>
                <div className="pg-detail-meta">
                  <span>{getInteractionLocation(selectedInteraction)}</span>
                  <span className="pg-detail-sep">·</span>
                  <span>{selectedInteraction.turn_count}/10 turns</span>
                  <span className="pg-detail-sep">·</span>
                  <span className={`pg-status-pill pg-status-${selectedInteraction.status}`}>
                    {selectedInteraction.status}
                  </span>
                </div>
              </div>
              <button className="pg-detail-close" onClick={() => setSelectedInteraction(null)}>×</button>
            </div>

            <div className="pg-detail-body">
              {/* Transcript */}
              <div className="pg-detail-section">
                <h5 className="pg-detail-section-title">TRANSCRIPT</h5>
                <pre className="pg-transcript-block">{getInteractionTranscript(selectedInteraction)}</pre>
              </div>

              {/* Turn log */}
              {selectedInteraction.turns && selectedInteraction.turns.length > 0 && (
                <div className="pg-detail-section">
                  <h5 className="pg-detail-section-title">ACTIONS</h5>
                  <div className="pg-turns-list">
                    {selectedInteraction.turns.map((turn, idx) => (
                      <div key={idx} className="pg-turn-row">
                        <span className="pg-turn-num">{turn.turn_number}</span>
                        <div className="pg-turn-info">
                          {turn.action_type !== 'none' && (
                            <span className="pg-turn-action">{turn.action_type} → {turn.action_target || 'N/A'}</span>
                          )}
                          {turn.location_after !== turn.location_before && (
                            <span className="pg-turn-move">{turn.location_before} → {turn.location_after}</span>
                          )}
                          {turn.action_type === 'none' && turn.location_after === turn.location_before && (
                            <span className="pg-turn-idle">idle</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
