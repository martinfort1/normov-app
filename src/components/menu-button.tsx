'use client';

export function MenuButton() {
  return (
    <button className="btn menu-btn" type="button" onClick={() => window.dispatchEvent(new Event('normov:toggle-menu'))}>
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>
      Menú
    </button>
  );
}
