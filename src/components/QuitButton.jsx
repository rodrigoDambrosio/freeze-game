import React, { useState } from 'react';
import './QuitButton.css';

/**
 * QuitButton
 *
 * Lets a player end a round early if they get tired, with a two-step inline
 * confirm so a stray tap in a public kiosk doesn't end the round by accident.
 */
export default function QuitButton({ onConfirm }) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="quit-confirm animate-fadeIn">
        <span className="quit-confirm-label">¿Seguro?</span>
        <button className="btn btn-ghost quit-confirm-btn" onClick={() => setConfirming(false)}>
          Cancelar
        </button>
        <button className="btn btn-danger quit-confirm-btn" onClick={onConfirm}>
          Sí, salir
        </button>
      </div>
    );
  }

  return (
    <button id="quit-game-btn" className="quit-btn" onClick={() => setConfirming(true)}>
      Salir
    </button>
  );
}
