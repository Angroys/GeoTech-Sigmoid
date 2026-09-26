import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';

// Left slide-out navigation, available on every page.
export function BurgerMenu() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();

  // Close whenever the route changes.
  useEffect(() => setOpen(false), [loc.pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="burger-btn"
        aria-label={open ? 'Close menu' : 'Open menu'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
        <span />
      </button>
      {open && <div className="burger-scrim" onClick={() => setOpen(false)} />}
      <nav className={`burger-drawer ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="burger-title">GeoTech-Sigmoid</div>
        <NavLink to="/" end className="burger-link">
          ▦ Tiles
        </NavLink>
        <NavLink to="/map" className="burger-link">
          ◫ Map — progress
        </NavLink>
        <NavLink to="/export" className="burger-link">
          ⇩ Export
        </NavLink>
      </nav>
    </>
  );
}
