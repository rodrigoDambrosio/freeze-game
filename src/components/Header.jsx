import React from 'react';
import './Header.css';

/** Back arrow icon */
function BackIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

/** Sun icon for light mode indicator */
function SunIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

/** Moon icon for dark mode indicator */
function MoonIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default function Header({ theme, onToggleTheme, onBack }) {
  const isDark = theme === 'dark';

  return (
    <header className="header">
      <div className="header-left">
        {onBack && (
          <button
            id="header-back-btn"
            className="header-icon-btn"
            onClick={onBack}
            title="Volver al inicio"
            aria-label="Volver al inicio"
          >
            <BackIcon />
          </button>
        )}

        <div className="header-brand">
          <div className="header-logo">
            <svg width="30" height="30" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <circle cx="20" cy="20" r="18" stroke="var(--signal)" strokeWidth="1.8" fill="rgba(91,156,245,0.07)" />
              <path d="M20 10 C14 10, 10 15, 10 20 C10 26, 14 30, 20 30" stroke="var(--signal)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              <path d="M20 10 C26 10, 30 15, 30 20 C30 26, 26 30, 20 30" stroke="var(--pulse)" strokeWidth="2.2" strokeLinecap="round" fill="none" />
              <circle cx="20" cy="20" r="3" fill="var(--signal)" />
              <circle cx="20" cy="12" r="1.8" fill="var(--signal)" opacity="0.6" />
              <circle cx="20" cy="28" r="1.8" fill="var(--pulse)" opacity="0.6" />
            </svg>
          </div>
          <div className="header-text">
            <span className="header-title">C.U.I.D.A.</span>
            <span className="header-subtitle">Freeze Challenge</span>
          </div>
        </div>
      </div>

      <div className="header-controls">
        {/* Theme toggle */}
        <button
          id="theme-toggle-btn"
          className="header-icon-btn"
          onClick={onToggleTheme}
          title={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
          aria-label={isDark ? 'Activar tema claro' : 'Activar tema oscuro'}
        >
          {isDark ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
