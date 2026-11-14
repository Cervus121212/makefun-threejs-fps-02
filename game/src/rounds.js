// The match: rounds, sides, money and the buy menu. One object owns the numbers;
// main.js owns the world (spawns, spike, bots) and calls these hooks at the right
// moments. Sides swap every round: Vanguard attacks on odd rounds, defends on even.
import { WEAPONS, BUY_ORDER } from './weapons.js';

export const FREEZE_SECONDS = 12;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 5;

const WIN_MONEY = 3250;
const LOSS_MONEY = 1900;
const KILL_MONEY = 300;
const PLANT_MONEY = 300;
const START_MONEY = 800;

export function createMatch() {
  const state = {
    phase: 'freeze', // freeze | live | over
    round: 1,
    wins: { vanguard: 0, ember: 0 },
    timeLeft: FREEZE_SECONDS,
    money: START_MONEY,
    weaponId: 'rifle',
    grenades: 0,
    kills: 0,
    deaths: 0,
    plants: 0,
    defuses: 0,
    matchOver: false,
    matchWinner: null,
    roundWinner: null,
    roundReason: '',
    banner: '',
  };

  function attackingTeam() {
    return state.round % 2 === 1 ? 'vanguard' : 'ember';
  }

  function defendingTeam() {
    return attackingTeam() === 'vanguard' ? 'ember' : 'vanguard';
  }

  function startRound() {
    state.phase = 'freeze';
    state.timeLeft = FREEZE_SECONDS;
    state.roundWinner = null;
    state.roundReason = '';
    state.banner = state.round === 1
      ? `Round 1 — ${attackingTeam() === 'vanguard' ? 'Vanguard attacks. Plant the spike.' : 'Ember attacks. Hold the sites.'}`
      : `Round ${state.round} — ${attackingTeam() === 'vanguard' ? 'Vanguard attacks' : 'Ember attacks'}`;
  }

  function beginLive() {
    state.phase = 'live';
    state.timeLeft = ROUND_SECONDS;
  }

  function award(win) {
    state.money += win ? WIN_MONEY : LOSS_MONEY;
  }

  // Ends the round for one reason; returns false if the round was already over.
  function endRound(winner, reason) {
    if (state.phase === 'over') return false;
    state.phase = 'over';
    state.roundWinner = winner;
    state.roundReason = reason;
    state.wins[winner] += 1;
    award(winner === 'vanguard');
    state.banner = winner === 'vanguard'
      ? `Vanguard takes round ${state.round} — ${reason}`
      : `Ember takes round ${state.round} — ${reason}`;
    if (state.wins[winner] >= WIN_ROUNDS) {
      state.matchOver = true;
      state.matchWinner = winner;
    }
    return true;
  }

  function nextRound() {
    state.round += 1;
    startRound();
  }

  function buy(itemId) {
    if (state.phase !== 'freeze') return { ok: false, why: 'Buy menu is only open during freeze time.' };
    if (itemId === 'grenade') {
      if (state.grenades >= 2) return { ok: false, why: 'You already carry 2 grenades.' };
      if (state.money < 300) return { ok: false, why: 'Not enough money for a frag grenade.' };
      state.money -= 300;
      state.grenades += 1;
      return { ok: true, what: 'Frag grenade' };
    }
    const def = WEAPONS[itemId];
    if (!def) return { ok: false, why: 'Unknown item.' };
    if (state.weaponId === itemId) return { ok: false, why: `You already carry the ${def.name}.` };
    if (state.money < def.price) return { ok: false, why: `The ${def.name} costs $${def.price}.` };
    state.money -= def.price;
    state.weaponId = itemId;
    return { ok: true, what: def.name };
  }

  function onKill() {
    state.kills += 1;
    state.money += KILL_MONEY;
  }

  function onDeath() {
    state.deaths += 1;
  }

  function onPlant() {
    state.plants += 1;
    state.money += PLANT_MONEY;
  }

  function onDefuse() {
    state.defuses += 1;
  }

  function resetMatch() {
    state.round = 1;
    state.wins.vanguard = 0;
    state.wins.ember = 0;
    state.money = START_MONEY;
    state.weaponId = 'rifle';
    state.grenades = 0;
    state.kills = 0;
    state.deaths = 0;
    state.plants = 0;
    state.defuses = 0;
    state.matchOver = false;
    state.matchWinner = null;
    startRound();
  }

  startRound();

  return {
    state,
    attackingTeam,
    defendingTeam,
    startRound,
    beginLive,
    endRound,
    nextRound,
    buy,
    onKill,
    onDeath,
    onPlant,
    onDefuse,
    resetMatch,
    buyList() {
      return BUY_ORDER.map((id) => WEAPONS[id]);
    },
  };
}
