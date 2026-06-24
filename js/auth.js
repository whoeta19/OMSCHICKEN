// Shared auth helper — included by all pages
const SUPABASE_URL = 'https://sqyppamdxahvvkoxovpu.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxeXBwYW1keGFodnZrb3hvdnB1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxNjQ2MzgsImV4cCI6MjA5NTc0MDYzOH0.tezDMDqlkzlWG0t8zBFyb3tJylFCeySgPByVKLkdlsM';
const TOKEN_KEY = 'omsfin_token';
const REFRESH_KEY = 'omsfin_refresh';

async function getValidToken() {
  const token = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('omschicken_token');
  const refresh = localStorage.getItem(REFRESH_KEY) || localStorage.getItem('omschicken_refresh');
  if (token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp - Math.floor(Date.now()/1000) > 300) return token;
    } catch(e) {}
  }
  if (!refresh) { window.location.href = '/login'; return null; }
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: {'apikey': SUPABASE_ANON, 'Content-Type': 'application/json'},
      body: JSON.stringify({refresh_token: refresh})
    });
    const data = await r.json();
    if (data.access_token) {
      localStorage.setItem(TOKEN_KEY, data.access_token);
      localStorage.setItem(REFRESH_KEY, data.refresh_token);
      return data.access_token;
    }
  } catch(e) {}
  window.location.href = '/login';
  return null;
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || localStorage.getItem('omschicken_token') || '';
}

// Fetch interceptor: auto-adds Authorization and handles 401 refresh on all /api/ calls
const _origFetch = window.fetch;
window.fetch = async function(url, opts = {}) {
  if (typeof url === 'string' && url.startsWith('/api/')) {
    const tok = await getValidToken();
    if (tok) opts = {...opts, headers: {...(opts.headers||{}), 'Authorization': 'Bearer ' + tok}};
    const r = await _origFetch(url, opts);
    if (r.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      const newTok = await getValidToken();
      if (newTok) {
        opts.headers = {...(opts.headers||{}), 'Authorization': 'Bearer ' + newTok};
        return _origFetch(url, opts);
      }
    }
    return r;
  }
  return _origFetch(url, opts);
};

// Refresh every 30 min proactively
setInterval(async () => { localStorage.removeItem(TOKEN_KEY); await getValidToken(); }, 30 * 60 * 1000);
