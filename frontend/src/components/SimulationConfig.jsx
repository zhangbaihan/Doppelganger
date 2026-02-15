import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const DEFAULT_ITEMS = [
  { id: 1, name: 'Couch', x: 200, y: 150, type: 'furniture' },
  { id: 2, name: 'Table', x: 400, y: 250, type: 'furniture' },
  { id: 3, name: 'Chair', x: 150, y: 200, type: 'furniture' },
  { id: 4, name: 'Window', x: 50, y: 100, type: 'feature' },
];

export default function SimulationConfig({ token, currentUser, onSimulationCreated }) {
  const [items, setItems] = useState(DEFAULT_ITEMS);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [participants, setParticipants] = useState([
    { userId: currentUser.id, isRandom: false },
    { userId: null, isRandom: true },
  ]);
  const [numSimulations, setNumSimulations] = useState(1);
  const [simulationName, setSimulationName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [draggedItem, setDraggedItem] = useState(null);
  const [boardSize] = useState({ width: 600, height: 400 });

  useEffect(() => {
    loadAvailableUsers();
  }, []);

  async function loadAvailableUsers() {
    try {
      const res = await fetch(`${API_URL}/api/simulations/available-users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  }

  function handleItemDragStart(e, item) {
    setDraggedItem(item);
  }

  function handleBoardDrop(e) {
    e.preventDefault();
    if (!draggedItem) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setItems((prev) =>
      prev.map((item) =>
        item.id === draggedItem.id ? { ...item, x: Math.max(0, Math.min(x, boardSize.width - 20)), y: Math.max(0, Math.min(y, boardSize.height - 20)) } : item
      )
    );
    setDraggedItem(null);
  }

  function handleBoardDragOver(e) {
    e.preventDefault();
  }

  function handleAddItem() {
    const newItem = {
      id: Date.now(),
      name: `Item ${items.length + 1}`,
      x: 100,
      y: 100,
      type: 'furniture',
    };
    setItems([...items, newItem]);
  }

  function handleRemoveItem(itemId) {
    setItems(items.filter((item) => item.id !== itemId));
  }

  function handleParticipantChange(index, field, value) {
    setParticipants((prev) => {
      const updated = [...prev];
      if (field === 'isRandom') {
        updated[index] = { ...updated[index], isRandom: value, userId: value ? null : (index === 0 ? currentUser.id : null) };
      } else if (field === 'userId') {
        updated[index] = { ...updated[index], userId: value, isRandom: false };
      }
      return updated;
    });
  }

  async function handleCreateSimulation() {
    if (participants.filter((p) => !p.isRandom && !p.userId).length > 0) {
      alert('Please select participants or mark them as random');
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch(`${API_URL}/api/simulations/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: simulationName || 'Untitled Simulation',
          items: items.map(({ id, ...rest }) => rest),
          participants: participants.map((p, i) => ({
            userId: p.isRandom ? null : p.userId,
            isRandom: p.isRandom,
            role: `agent${i + 1}`,
          })),
          numSimulations,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create simulation');
      }

      const data = await res.json();
      onSimulationCreated(data.simulationId);
    } catch (err) {
      console.error('Create simulation error:', err);
      alert(err.message || 'Failed to create simulation');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="simulation-config">
      <h3 className="section-title">CREATE SIMULATION</h3>

      <div className="config-section">
        <label className="config-label">Simulation Name</label>
        <input
          type="text"
          className="config-input"
          value={simulationName}
          onChange={(e) => setSimulationName(e.target.value)}
          placeholder="My Simulation"
          maxLength={50}
        />
      </div>

      <div className="config-section">
        <div className="config-header">
          <label className="config-label">World Items</label>
          <button className="config-btn-small" onClick={handleAddItem}>
            + Add Item
          </button>
        </div>
        <div
          className="config-board"
          onDrop={handleBoardDrop}
          onDragOver={handleBoardDragOver}
          style={{ width: boardSize.width, height: boardSize.height }}
        >
          {items.map((item) => (
            <div
              key={item.id}
              className="config-item"
              draggable
              onDragStart={(e) => handleItemDragStart(e, item)}
              style={{ left: item.x, top: item.y }}
            >
              <span className="item-name">{item.name}</span>
              <button
                className="item-remove"
                onClick={() => handleRemoveItem(item.id)}
                title="Remove item"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <p className="config-hint">Drag items to position them in the world</p>
      </div>

      <div className="config-section">
        <label className="config-label">Participants</label>
        {participants.map((participant, index) => (
          <div key={index} className="participant-row">
            <span className="participant-label">Agent {index + 1}:</span>
            <label className="participant-checkbox">
              <input
                type="checkbox"
                checked={participant.isRandom}
                onChange={(e) => handleParticipantChange(index, 'isRandom', e.target.checked)}
              />
              Random
            </label>
            {!participant.isRandom && (
              <select
                className="participant-select"
                value={participant.userId || ''}
                onChange={(e) => handleParticipantChange(index, 'userId', parseInt(e.target.value))}
              >
                <option value="">Select user...</option>
                {index === 0 && (
                  <option value={currentUser.id}>
                    {currentUser.bit_name} (You)
                  </option>
                )}
                {availableUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.bit_name} ({user.name})
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </div>

      <div className="config-section">
        <label className="config-label">Number of Simulations</label>
        <input
          type="number"
          className="config-input"
          min="1"
          max="10"
          value={numSimulations}
          onChange={(e) => setNumSimulations(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
        />
        <p className="config-hint">Run multiple simulations with the same setup</p>
      </div>

      <button
        className="config-submit-btn"
        onClick={handleCreateSimulation}
        disabled={isCreating || items.length === 0}
      >
        {isCreating ? 'CREATING...' : 'CREATE & RUN SIMULATION'}
      </button>
    </div>
  );
}
