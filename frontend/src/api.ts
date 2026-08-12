import axios from 'axios';
import type { AxiosError } from 'axios';

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
  // Without a timeout a request hangs forever if the server accepts the
  // connection but never replies — the spinner spins and the user is told
  // nothing. 30s is well past any normal response; the genuinely slow work
  // (knowledge-base scraping, agent provisioning) runs as a background task
  // on the server and returns immediately.
  timeout: 30000,
});

// Interceptor to inject JWT token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
}, (error) => {
  return Promise.reject(error);
});

/**
 * Turns any thrown request error into one sentence a person can act on.
 *
 * The reason this exists: every page used to do
 *   `err.response?.data?.detail || 'Failed to load X'`
 * which collapses every distinct failure into the same message. "Failed to
 * load settings" was shown whether the server was down, the session had
 * expired, or the account lacked permission — three problems with three
 * different fixes, all indistinguishable to whoever is looking at the screen.
 */
export function getErrorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const error = err as AxiosError<any>;

  // Not an HTTP error at all (a bug in our own code) — surface it rather than
  // dressing it up as a server problem.
  if (!error?.isAxiosError) {
    return (err as Error)?.message || fallback;
  }

  // The request never got a reply.
  if (!error.response) {
    if (error.code === 'ECONNABORTED' || /timeout/i.test(error.message || '')) {
      return 'The server took too long to respond. It may be busy — please try again.';
    }
    return `Cannot reach the server at ${API_BASE}. Check that it is running and that you are online.`;
  }

  const { status, data } = error.response;

  // A JSON API that answers with HTML is almost always a proxy or routing
  // problem, not an application error — this is exactly what happened when a
  // deployment served the frontend's index.html for /api/* and every call
  // "succeeded" with a body the app couldn't read. Say so, because the raw
  // status code points nowhere near the real cause.
  const contentType = String(error.response.headers?.['content-type'] || '');
  if (contentType.includes('text/html')) {
    return `The server returned a web page instead of data (HTTP ${status}). The API URL is probably wrong or the backend is not reachable at ${API_BASE}.`;
  }

  // FastAPI's validation errors put an ARRAY of objects in `detail`, which
  // renders as "[object Object]" if passed straight to a toast.
  const detail = data?.detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    const field = Array.isArray(first?.loc) ? first.loc[first.loc.length - 1] : null;
    const msg = first?.msg || 'is invalid';
    return field ? `${field}: ${msg}` : String(msg);
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof data?.error === 'string' && data.error.trim()) return data.error;
  if (typeof data?.message === 'string' && data.message.trim()) return data.message;

  // No usable body — fall back to something specific to the status.
  switch (status) {
    case 400: return 'That request was not valid. Please check the details and try again.';
    case 401: return 'Your session has expired. Please sign in again.';
    case 403: return 'You do not have permission to do that.';
    case 404: return 'That item no longer exists. It may have been deleted.';
    case 409: return 'That conflicts with something that already exists.';
    case 413: return 'That file is too large to upload.';
    case 429: return 'Too many requests. Please wait a moment and try again.';
    case 502:
    case 503:
    case 504: return 'The server is unavailable right now. Please try again shortly.';
    default:
      if (status >= 500) return `The server hit an error (HTTP ${status}). Please try again, and tell an administrator if it keeps happening.`;
      return fallback;
  }
}

// Interceptor to handle 401 Unauthorized errors globally
api.interceptors.response.use((response) => {
  return response;
}, (error) => {
  // Attach the human-readable message once, here, so every caller gets the
  // same wording without repeating the logic in each catch block.
  (error as any).userMessage = getErrorMessage(error);

  // A 401 from an AUTH endpoint is a failed sign-in attempt, not an expired
  // session — there is no session yet. Reloading there wiped the login form's
  // error message before anyone could read it, so a wrong password looked
  // like the page had simply refreshed for no reason.
  const url = error.config?.url || '';
  const isAuthAttempt = /\/auth\/(login|identify|set-new-password)$/.test(url);

  if (error.response && error.response.status === 401 && !isAuthAttempt) {
    console.warn('[API] Unauthorized access detected, clearing token.');
    localStorage.removeItem('token');
    // Clear the cached user too — otherwise the next login briefly renders
    // the previous account's school name and nav from stale localStorage.
    localStorage.removeItem('user');
    window.location.reload();
  } else {
    // Keep the technical detail in the console for whoever debugs it; the
    // user gets the sentence above.
    console.error(
      `[API] ${error.config?.method?.toUpperCase?.() || 'REQUEST'} ${error.config?.url || ''} failed:`,
      error.response?.status || error.code || 'no response',
      error.response?.data ?? error.message
    );
  }
  return Promise.reject(error);
});

export default api;
