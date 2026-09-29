// Custom teams live in this browser's localStorage.
const KEY = 'pgf:customTeams';

export function loadCustomTeams() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; }
}
export function saveCustomTeam(team) {
  const list = loadCustomTeams().filter((t) => t.id !== team.id);
  list.push(team);
  return write(list);
}
export function deleteCustomTeam(id) {
  return write(loadCustomTeams().filter((t) => t.id !== id));
}
