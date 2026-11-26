// Google sign-in (Google Identity Services token flow). The only outside script the program loads.
// Scope drive.file: the program can only see files it created itself.
import { CLIENT_ID } from './config.js';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const googleReady = () => !!CLIENT_ID;
function loadGIS() {
  return new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not reach Google. Check your internet connection.'));
    document.head.append(s);
  });
}
export class Auth {
  constructor() { this._token = ''; this._exp = 0; this.client = null; this.email = ''; }
  token() { return this._token; }
  expiresAt() { return this._exp; }
  async _init() {
    await loadGIS();
    if (!this.client) this.client = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: (r) => this._cb?.(r), error_callback: (e) => this._ecb?.(e) });
  }
  preload() { if (googleReady()) this._init().catch(() => {}); }
  // Must be called from a click (the browser blocks pop-ups otherwise).
  async signIn(prompt = '') {
    await this._init();
    return new Promise((res, rej) => {
      this._cb = (r) => {
        if (r.error) return rej(new Error(r.error_description || r.error));
        this._token = r.access_token; this._exp = Date.now() + (Number(r.expires_in) || 3600) * 1000; res();
      };
      this._ecb = (e) => rej(new Error(e.type === 'popup_closed' ? 'The Google window was closed.' : (e.message || e.type)));
      this.client.requestAccessToken({ prompt });
    });
  }
  reconnect() { return this.signIn(''); }
  async who() {
    try { const r = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + this._token } }); const j = await r.json(); this.email = j.user?.emailAddress || ''; } catch { /* optional */ }
    return this.email;
  }
  revoke() { try { google.accounts.oauth2.revoke(this._token); } catch { /* ignore */ } this._token = ''; this._exp = 0; }
}
