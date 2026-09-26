"""Dev entrypoint. Equivalent: uvicorn app.main:app --host 0.0.0.0 --port 8000
(bind 0.0.0.0 so the Headscale/Tailscale mesh can reach it)."""
from __future__ import annotations

import uvicorn

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=False)
