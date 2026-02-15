import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export default function SimulationViewer({ token, simulationId }) {
  const [simulation, setSimulation] = useState(null);
  const [currentRunIndex, setCurrentRunIndex] = useState(0);
  const [currentStateIndex, setCurrentStateIndex] = useState(0);
  const [states, setStates] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playInterval, setPlayInterval] = useState(null);

  useEffect(() => {
    if (simulationId) {
      loadSimulation();
    }
    return () => {
      if (playInterval) clearInterval(playInterval);
    };
  }, [simulationId]);

  useEffect(() => {
    if (simulationId && currentRunIndex !== null) {
      loadSimulationRun(currentRunIndex);
    }
  }, [simulationId, currentRunIndex]);

  async function loadSimulation() {
    try {
      const res = await fetch(`${API_URL}/api/simulations/${simulationId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSimulation(data.simulation);
        if (data.runs && data.runs.length > 0) {
          setCurrentRunIndex(0);
        }
      }
    } catch (err) {
      console.error('Failed to load simulation:', err);
    }
  }

  async function loadSimulationRun(runIndex) {
    try {
      const res = await fetch(`${API_URL}/api/simulations/${simulationId}/runs/${runIndex}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setStates(data.states);
        setCurrentStateIndex(0);
      }
    } catch (err) {
      console.error('Failed to load simulation run:', err);
    }
  }

  function handlePlayPause() {
    if (isPlaying) {
      if (playInterval) {
        clearInterval(playInterval);
        setPlayInterval(null);
      }
      setIsPlaying(false);
    } else {
      if (currentStateIndex >= states.length - 1) {
        setCurrentStateIndex(0);
      }
      setIsPlaying(true);
      const interval = setInterval(() => {
        setCurrentStateIndex((prev) => {
          if (prev >= states.length - 1) {
            clearInterval(interval);
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 2000); // 2 seconds per state
      setPlayInterval(interval);
    }
  }

  function handleStateChange(newIndex) {
    setCurrentStateIndex(Math.max(0, Math.min(newIndex, states.length - 1)));
    if (isPlaying) {
      handlePlayPause();
    }
  }

  if (!simulation) {
    return (
      <div className="simulation-viewer">
        <div className="viewer-loading">Loading simulation...</div>
      </div>
    );
  }

  const currentState = states[currentStateIndex] || null;
  const config = simulation.config || {};
  const items = currentState?.items || config.items || [];
  const agentPositions = currentState?.agentPositions || {};
  const transcript = currentState?.transcript || '';
  const narrativeEvents = currentState?.narrativeEvents || [];

  const runs = simulation.runs || [];
  const boardSize = { width: 600, height: 400 };

  return (
    <div className="simulation-viewer">
      <div className="viewer-header">
        <h3 className="section-title">{simulation.name || 'Simulation'}</h3>
        {runs.length > 1 && (
          <div className="run-selector">
            <label>Simulation:</label>
            <select
              className="run-select"
              value={currentRunIndex}
              onChange={(e) => setCurrentRunIndex(parseInt(e.target.value))}
            >
              {runs.map((run, index) => (
                <option key={run.id} value={index}>
                  Sim {index + 1} ({run.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="viewer-content">
        <div className="viewer-board-section">
          <div className="viewer-board" style={{ width: boardSize.width, height: boardSize.height }}>
            {/* Items */}
            {items.map((item, index) => (
              <div
                key={index}
                className="viewer-item"
                style={{ left: item.x, top: item.y }}
                title={item.name}
              >
                <span className="item-label">{item.name}</span>
              </div>
            ))}

            {/* Agents */}
            {Object.entries(agentPositions).map(([role, position]) => {
              const agentNum = role.replace('agent', '');
              const isEven = parseInt(agentNum) % 2 === 0;
              return (
                <div
                  key={role}
                  className={`viewer-agent ${isEven ? 'agent2' : 'agent1'}`}
                  style={{ left: position.x, top: position.y }}
                >
                  <div className="agent-marker" />
                  <span className="agent-label">Agent {agentNum}</span>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="viewer-controls">
            <button className="control-btn" onClick={() => handleStateChange(0)}>
              First
            </button>
            <button
              className="control-btn"
              onClick={() => handleStateChange(currentStateIndex - 1)}
              disabled={currentStateIndex === 0}
            >
              Prev
            </button>
            <button className="control-btn play-btn" onClick={handlePlayPause}>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="control-btn"
              onClick={() => handleStateChange(currentStateIndex + 1)}
              disabled={currentStateIndex >= states.length - 1}
            >
              Next
            </button>
            <button
              className="control-btn"
              onClick={() => handleStateChange(states.length - 1)}
              disabled={currentStateIndex >= states.length - 1}
            >
              Last
            </button>
            <span className="state-indicator">
              State {currentStateIndex + 1} / {states.length}
            </span>
          </div>

          {/* Timeline scrubber */}
          {states.length > 1 && (
            <div className="viewer-timeline">
              <input
                type="range"
                min="0"
                max={states.length - 1}
                value={currentStateIndex}
                onChange={(e) => handleStateChange(parseInt(e.target.value))}
                className="timeline-slider"
              />
            </div>
          )}
        </div>

        {/* Transcript panel */}
        <div className="viewer-transcript">
          <h4 className="transcript-title">CONVERSATION</h4>
          <div className="transcript-content">
            {narrativeEvents.length > 0 && (
              <div className="narrative-events">
                {narrativeEvents.map((event, i) => (
                  <div key={i} className="narrative-event">
                    [EVENT] {event}
                  </div>
                ))}
              </div>
            )}
            {transcript ? (
              <div className="transcript-text">
                {transcript.split('\n').map((line, i) => {
                  if (line.startsWith('[') && line.endsWith(']')) {
                    return (
                      <div key={i} className="transcript-narrative">
                        {line}
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="transcript-line">
                      {line}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="transcript-empty">No conversation yet...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
