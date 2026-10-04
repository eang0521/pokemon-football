// Custom teams live in this browser's localStorage.
const KEY = 'pgf:customTeams';

export function loadCustomTeams() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { lastError = e; return false; }
}
let lastError = null;
export const lastStorageError = () => lastError;

// Why a localStorage write failed, in words a player can act on.
export function storageErrorText(e) {
  let mine = 0, all = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), n = k.length + (localStorage.getItem(k) || '').length;
      all += n; if (k.startsWith('pgf:')) mine += n;
    }
  } catch { /* ignore */ }
  // a "quota" error with next to nothing stored is really a block (older Safari private mode)
  const full = e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014) && all > 50000;
  if (!full) return 'Could not save: this browser is blocking site storage (private browsing, or site data turned off for this site). Progress on this page is kept until you close or reload it.';
  const kb = (n) => `${Math.round(n * 2 / 1024)} KB`; // UTF-16: 2 bytes per character
  return `Could not save: this site's browser storage is full (${kb(all)} used, ${kb(mine)} of it by Pokémon Gridiron). `
    + (mine > all / 2 ? 'Delete some old adventures or custom teams to free space.' : `Other pages on ${location.host} are using most of it; clearing their site data frees space.`);
}
export function saveCustomTeam(team) {
  const list = loadCustomTeams().filter((t) => t.id !== team.id);
  list.push(team);
  return write(list);
}
export function deleteCustomTeam(id) {
  return write(loadCustomTeams().filter((t) => t.id !== id));
}
