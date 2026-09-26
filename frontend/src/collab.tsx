import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api } from './api';
import type { PresenceUser, PresenceLock } from './types';

// localStorage keys + the BroadcastChannel name for the single-tab guard.
const CLIENT_ID_KEY = 'geotech-client-id';
const NAME_KEY = 'geotech-name';
const TAB_CHANNEL = 'geotech-tab';
const HEARTBEAT_MS = 5000;

// --- Guarded storage helpers (private mode / blocked cookies may throw). ---
function safeLocalGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeLocalSet(key: string, val: string): void {
  try {
    localStorage.setItem(key, val);
  } catch {
    /* ignore */
  }
}

// Stable id generator (crypto.randomUUID when available, fallback otherwise).
function genId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function ensureClientId(): string {
  let id = safeLocalGet(CLIENT_ID_KEY);
  if (!id) {
    id = genId();
    safeLocalSet(CLIENT_ID_KEY, id);
  }
  return id;
}

interface CollabValue {
  clientId: string;
  /** Display name. Empty string until the user picks one. */
  name: string;
  setName: (n: string) => void;
  /** Everyone online EXCEPT this client. */
  users: PresenceUser[];
  locks: PresenceLock[];
  /** Whether THIS tab is the active tab (only the active tab heartbeats). */
  active: boolean;
  /** Tile currently being viewed (drives the heartbeat's `tile` field). */
  currentTile: string | null;
  setCurrentTile: (t: string | null) => void;
}

const DEFAULT: CollabValue = {
  clientId: '',
  name: '',
  setName: () => {},
  users: [],
  locks: [],
  active: false,
  currentTile: null,
  setCurrentTile: () => {},
};

const Ctx = createContext<CollabValue>(DEFAULT);

export function useCollab(): CollabValue {
  return useContext(Ctx);
}

// Deterministic HSL colour from a client id, for avatars.
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 46%)`;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CollabProvider({ children }: { children: React.ReactNode }) {
  const clientIdRef = useRef<string>(ensureClientId());
  const clientId = clientIdRef.current;

  const [name, setNameState] = useState<string>(() => safeLocalGet(NAME_KEY) ?? '');
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [locks, setLocks] = useState<PresenceLock[]>([]);
  const [active, setActive] = useState<boolean>(false);
  const [currentTile, setCurrentTile] = useState<string | null>(null);

  const currentTileRef = useRef<string | null>(currentTile);
  currentTileRef.current = currentTile;
  const activeRef = useRef(active);
  activeRef.current = active;

  const setName = useCallback((n: string) => {
    const v = n.trim();
    if (!v) return;
    setNameState(v);
    safeLocalSet(NAME_KEY, v);
  }, []);

  // ---- Single-tab guard (BroadcastChannel + ping/pong election). ----
  const tabIdRef = useRef<string>(genId());
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') bc = new BroadcastChannel(TAB_CHANNEL);
    } catch {
      bc = null;
    }
    channelRef.current = bc;

    // No BroadcastChannel support → assume single tab and become active.
    if (!bc) {
      setActive(true);
      return;
    }

    let decided = false;
    const tabId = tabIdRef.current;
    const becomeActive = () => {
      decided = true;
      setActive(true);
    };

    const tryReclaim = () => {
      if (activeRef.current) return;
      decided = false;
      try {
        bc!.postMessage({ type: 'ping', from: tabId });
      } catch {
        /* ignore */
      }
      window.setTimeout(() => {
        if (!decided && !activeRef.current) becomeActive();
      }, 250);
    };

    const onMsg = (ev: MessageEvent) => {
      const msg = ev.data as { type?: string; from?: string } | null;
      if (!msg || msg.from === tabId) return;
      switch (msg.type) {
        case 'ping':
          // Another tab is probing; if we're active, announce ourselves.
          if (activeRef.current) {
            try {
              bc!.postMessage({ type: 'pong', from: tabId });
            } catch {
              /* ignore */
            }
          }
          break;
        case 'pong':
          // An active tab already exists → stay inactive.
          decided = true;
          setActive(false);
          break;
        case 'takeover':
          // Another tab explicitly claimed active → step down.
          setActive(false);
          break;
        case 'released':
          // The active tab left; inactive tabs race (staggered) to reclaim.
          window.setTimeout(tryReclaim, Math.random() * 200);
          break;
        default:
          break;
      }
    };
    bc.addEventListener('message', onMsg);

    // On mount, probe for an existing active tab; become active if none answers.
    try {
      bc.postMessage({ type: 'ping', from: tabId });
    } catch {
      /* ignore */
    }
    const t = window.setTimeout(() => {
      if (!decided) becomeActive();
    }, 250);

    const onLeave = () => {
      if (activeRef.current) {
        try {
          bc!.postMessage({ type: 'released', from: tabId });
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener('pagehide', onLeave);
    window.addEventListener('beforeunload', onLeave);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('pagehide', onLeave);
      window.removeEventListener('beforeunload', onLeave);
      bc.removeEventListener('message', onMsg);
      onLeave();
      try {
        bc.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  // "Use here" — take over from whichever tab is currently active.
  const activate = useCallback(() => {
    try {
      channelRef.current?.postMessage({ type: 'takeover', from: tabIdRef.current });
    } catch {
      /* ignore */
    }
    setActive(true);
  }, []);

  // ---- Presence heartbeat (active tab + named user only). ----
  // Re-runs on tile change so the new tile is reported (and its lock refreshed)
  // immediately, then every HEARTBEAT_MS.
  useEffect(() => {
    if (!active || !name) return;
    let cancelled = false;
    const beat = async () => {
      try {
        const res = await api.presence(clientId, name, currentTileRef.current);
        if (cancelled) return;
        setUsers(res.users.filter((u) => u.client_id !== clientId));
        setLocks(res.locks);
      } catch {
        /* degrade gracefully — never block labeling */
      }
    };
    void beat();
    const iv = window.setInterval(beat, HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [active, name, clientId, currentTile]);

  const value: CollabValue = {
    clientId,
    name,
    setName,
    users,
    locks,
    active,
    currentTile,
    setCurrentTile,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {active && !name && (
        <NameModal defaultName={`User-${clientId.slice(0, 4) || '0000'}`} onSubmit={setName} />
      )}
      {!active && <InactiveTabNotice onUse={activate} />}
    </Ctx.Provider>
  );
}

// Blocking modal shown on first load until a display name is chosen.
function NameModal({
  defaultName,
  onSubmit,
}: {
  defaultName: string;
  onSubmit: (n: string) => void;
}) {
  const [value, setValue] = useState(defaultName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    if (value.trim()) onSubmit(value);
  };

  return (
    <div className="modal-scrim" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="name-modal-title"
      >
        <h2 id="name-modal-title">Pick a display name</h2>
        <p className="modal__hint">
          Other labelers see this next to the tiles you edit.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            ref={inputRef}
            className="text-input"
            type="text"
            aria-label="Display name"
            maxLength={40}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <div className="modal__actions">
            <button type="submit" className="btn btn--primary" disabled={!value.trim()}>
              Continue
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Full-screen notice for a second tab in the same browser.
function InactiveTabNotice({ onUse }: { onUse: () => void }) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  return (
    <div className="modal-scrim" role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="inactive-tab-title"
      >
        <h2 id="inactive-tab-title">Open in another tab</h2>
        <p className="modal__hint">
          GeoTech-Sigmoid is already open in another tab of this browser. Only one tab
          stays live at a time.
        </p>
        <div className="modal__actions">
          <button ref={btnRef} type="button" className="btn btn--primary" onClick={onUse}>
            Use here
          </button>
        </div>
      </div>
    </div>
  );
}
