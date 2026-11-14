// The DOM HUD: health, ammo, money, timer, score, kill feed, buy menu and the
// overlays. It never touches the simulation; main.js pushes numbers in and reads
// the play / buy callbacks out. Cached last values keep DOM writes to a minimum.
export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playButton = $('play');
  const healthFill = $('health-fill');
  const healthValue = $('health-value');
  const moneyValue = $('money-value');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeCount = $('grenade-count');
  const timerValue = $('timer-value');
  const scoreValue = $('score-value');
  const aliveVanguard = $('alive-vanguard');
  const aliveEmber = $('alive-ember');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damageFlash = $('damage-flash');
  const spikeStatus = $('spike-status');
  const spikeTimer = $('spike-timer');
  const progressWrap = $('progress-wrap');
  const progressLabel = $('progress-label');
  const progressFill = $('progress-fill');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');

  let lastHealth = -1;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastAlive = '';
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastSpike = '';
  let hitTimer = 0;
  let bannerTimer = 0;

  function setText(node, value, last) {
    if (value === last) return last;
    node.textContent = value;
    return value;
  }

  return {
    setHealth(value) {
      const v = Math.max(0, Math.round(value));
      if (v === lastHealth) return;
      lastHealth = v;
      healthFill.style.width = `${v}%`;
      healthFill.classList.toggle('low', v <= 30);
      healthValue.textContent = String(v);
    },
    setAmmo(mag, reserve) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      ammoMag.parentElement.classList.toggle('empty', mag === 0);
    },
    setWeapon(name) {
      lastWeapon = setText(weaponName, name, lastWeapon);
    },
    setGrenades(n) {
      lastGrenades = setText(grenadeCount, n > 0 ? `◉ ${n}` : '', lastGrenades);
    },
    setMoney(value) {
      lastMoney = setText(moneyValue, `$${value}`, lastMoney);
    },
    setTimer(seconds, phase) {
      const v = Math.max(0, Math.ceil(seconds));
      if (v === lastTimer) return;
      lastTimer = v;
      const m = Math.floor(v / 60);
      const s = String(v % 60).padStart(2, '0');
      timerValue.textContent = `${m}:${s}`;
      timerValue.classList.toggle('freeze', phase === 'freeze');
      timerValue.classList.toggle('urgent', phase === 'live' && v <= 15);
    },
    setScore(vanguard, ember, round) {
      const v = `VAN ${vanguard} — ${ember} EMB · R${round}`;
      lastScore = setText(scoreValue, v, lastScore);
    },
    setAlive(vanguard, ember, playerAlive) {
      const v = `${vanguard}|${ember}|${playerAlive ? 1 : 0}`;
      if (v === lastAlive) return;
      lastAlive = v;
      aliveVanguard.textContent = '●'.repeat(vanguard) + (playerAlive ? '⬢' : '');
      aliveEmber.textContent = '●'.repeat(ember);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), killed ? 350 : 120);
    },
    damage() {
      damageFlash.classList.remove('on');
      void damageFlash.offsetWidth;
      damageFlash.classList.add('on');
    },
    killfeed(killer, victim, headshot) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = `${killer}  ✕  ${victim}${headshot ? '  ◉' : ''}`;
      killfeed.prepend(line);
      while (killfeed.children.length > 4) killfeed.lastChild.remove();
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(text, ms = 3600) {
      banner.textContent = text;
      banner.classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
    },
    hideBanner() {
      banner.classList.remove('on');
    },
    setSpike(state, seconds) {
      const v = state === 'planted' ? `SPIKE PLANTED — ${Math.max(0, Math.ceil(seconds))}s` : state === 'carried' ? 'SPIKE WITH YOU — REACH A SITE' : '';
      if (v === lastSpike) return;
      lastSpike = v;
      spikeStatus.textContent = v;
      spikeStatus.classList.toggle('planted', state === 'planted');
      spikeTimer.textContent = '';
    },
    setProgress(label, fraction) {
      if (!label) {
        progressWrap.hidden = true;
        return;
      }
      progressWrap.hidden = false;
      progressLabel.textContent = label;
      progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    },
    showOverlay(mode, data) {
      const texts = {
        start: {
          title: 'EMBERLINE',
          copy: 'Foundry Yard. Five on five, first to five rounds. Plant the spike at Furnace or Silo — or wipe the other team. Click to play.',
          action: 'Click to play',
        },
        paused: {
          title: 'EMBERLINE',
          copy: 'Paused. Click to resume.',
          action: 'Click to resume',
        },
        roundEnd: {
          title: data && data.winner === 'vanguard' ? 'Round to Vanguard' : 'Round to Ember',
          copy: data ? data.reason : '',
          action: 'Next round',
        },
        matchEnd: {
          title: data && data.winner === 'vanguard' ? 'VANGUARD WINS THE MATCH' : 'EMBER WINS THE MATCH',
          copy: data ? `Final ${data.vanguard} — ${data.ember}. ${data.kills} eliminations, $${data.money} earned.` : '',
          action: 'Play again',
        },
        dead: {
          title: 'You are down',
          copy: 'Your team fights on. Spectate until the round ends.',
          action: 'Keep watching',
        },
      };
      const text = texts[mode];
      if (!text) return;
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    renderBuy(list, money, ownedWeapon, grenades, onBuy) {
      buyMoney.textContent = `$${money}`;
      buyList.innerHTML = '';
      for (const def of list) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'buy-row';
        row.disabled = ownedWeapon === def.id || money < def.price;
        row.innerHTML = `<span class="buy-key">${def.id === 'pistol' ? '1' : def.id === 'smg' ? '2' : def.id === 'shotgun' ? '3' : def.id === 'rifle' ? '4' : '5'}</span><span class="buy-name">${def.name}</span><span class="buy-stat">${def.damage} dmg · ${def.magSize} rnd</span><span class="buy-price">$${def.price}</span>`;
        row.addEventListener('click', () => onBuy(def.id));
        buyList.appendChild(row);
      }
      const grenadeRow = document.createElement('button');
      grenadeRow.type = 'button';
      grenadeRow.className = 'buy-row';
      grenadeRow.disabled = grenades >= 2 || money < 300;
      grenadeRow.innerHTML = `<span class="buy-key">6</span><span class="buy-name">Frag grenade</span><span class="buy-stat">thrown with G · blast 6 m</span><span class="buy-price">$300</span>`;
      grenadeRow.addEventListener('click', () => onBuy('grenade'));
      buyList.appendChild(grenadeRow);
    },
    showBuy(show) {
      buyMenu.hidden = !show;
    },
  };
}
