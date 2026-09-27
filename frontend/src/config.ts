// Single source of truth for the API base.
// Default '' so built app hits relative /api/... on the same host (mesh).
// Override with VITE_API_BASE at build/dev time if needed.
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? '';

export const apiUrl = (path: string): string => {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${p}`;
};
