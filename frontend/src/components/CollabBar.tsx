import { useEffect, useRef, useState } from 'react';
import { useCollab, colorForId, initialsOf } from '../collab';

// Beyond this many seconds without a heartbeat, fade the user as idle.
const IDLE_FADE_SECS = 30;

/**
 * Header collaboration strip: colored avatars of everyone online (with the tile
 * each is editing + idle fade) followed by this client's own identity chip with
 * an inline rename control.
 */
export function CollabBar() {
  const { users, name, setName } = useCollab();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (renaming) {
      setDraft(name);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming, name]);

  const commit = () => {
    if (draft.trim()) setName(draft);
    setRenaming(false);
  };

  return (
    <div className="collab-bar" aria-label="Collaboration">
      <div className="live-users" role="list" aria-label="People online">
        {users.map((u) => {
          const idle = u.idle_secs >= IDLE_FADE_SECS;
          const tileShort = u.tile ? u.tile.replace(/\.tif$/, '') : null;
          return (
            <div
              key={u.client_id}
              role="listitem"
              className={`live-user${idle ? ' is-idle' : ''}`}
              title={`${u.name}${tileShort ? ` · ${tileShort}` : ' · idle'}${
                idle ? ` (${u.idle_secs}s idle)` : ''
              }`}
            >
              <span
                className="live-user__avatar"
                style={{ background: colorForId(u.client_id) }}
                aria-hidden="true"
              >
                {initialsOf(u.name)}
              </span>
            </div>
          );
        })}
      </div>

      {renaming ? (
        <form
          className="identity-edit"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
        >
          <input
            ref={inputRef}
            className="text-input text-input--sm"
            type="text"
            aria-label="Your display name"
            maxLength={40}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        </form>
      ) : (
        <button
          type="button"
          className="identity-chip"
          onClick={() => setRenaming(true)}
          title={`You: ${name || 'You'} — click to change your name`}
        >
          <span className="live-user__avatar identity-chip__avatar" aria-hidden="true">
            {initialsOf(name || '?')}
          </span>
        </button>
      )}
    </div>
  );
}
