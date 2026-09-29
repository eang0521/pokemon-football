// Shared helpers for the headless tools.
import { TeamDepth } from '../js/depth.js';
import { TEAMS } from '../js/data/teams.js';

// Build simulatePlay() args for team A on offense vs team B on defense.
export function playArgs({ rng, play, dcall, offTeam = TEAMS[0], defTeam = TEAMS[1], los = 30, ballY = 20, flip = 1, situation = { aggression: 0.5 } }) {
  const reg = {};
  const O = new TeamDepth(offTeam, reg), D = new TeamDepth(defTeam, reg);
  const pers = O.personnel;
  const form = play.forms[pers] || play.forms[Object.keys(play.forms)[0]];
  const personnel = play.forms[pers] ? pers : Object.keys(play.forms)[0];
  return {
    rng, W: 40, los, ballY, flip, play, dcall, situation, form,
    offense: { slots: O.simOffense({}), personnel },
    defense: { slots: D.simDefense({}) },
  };
}
