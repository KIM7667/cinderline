// The HUD is plain DOM over the canvas: top-centre match clock and score,
// bottom-left health, bottom-right money and ammunition, a kill feed, round
// banners, the buy menu, and the plant/defuse progress bar. createHud owns
// every element by id (index.html declares them) and the frame loop calls
// sync() with the match and the player; everything else is event-driven.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

const BUY_KEYS = [
  ['Digit1', 'ratter'], ['Digit2', 'longline'], ['Digit3', 'kestrel'], ['Digit4', 'mule'],
  ['Digit5', 'armor'], ['Digit6', 'frag'], ['Digit7', 'flash'], ['Digit8', 'smoke'],
];
export { BUY_KEYS };

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function createHud() {
  const el = (id) => document.getElementById(id);
  const root = {
    timer: el('timer'),
    phase: el('phase-label'),
    scoreA: el('score-attack'),
    scoreD: el('score-defend'),
    healthFill: el('health-fill'),
    healthText: el('health-text'),
    armorTag: el('armor-tag'),
    ammoBox: el('ammo'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    money: el('money'),
    feed: el('killfeed'),
    banner: el('banner'),
    bannerTitle: el('banner-title'),
    bannerSub: el('banner-sub'),
    buyMenu: el('buy-menu'),
    buyList: el('buy-list'),
    buyMoney: el('buy-money'),
    progress: el('progress'),
    progressFill: el('progress-fill'),
    progressLabel: el('progress-label'),
    vignette: el('vignette'),
    flash: el('flash-overlay'),
    hitmarker: el('hitmarker'),
    crosshair: el('crosshair'),
    overlay: el('overlay'),
    overlayTitle: el('overlay-title'),
    overlayCopy: el('overlay-copy'),
    playButton: el('play'),
    spectate: el('spectate'),
    chargeTag: el('charge-tag'),
  };

  let bannerUntil = 0;
  let hitUntil = 0;
  let lastBuyMoney = -1;
  let lastPhase = '';

  root.playButton.addEventListener('click', () => {
    if (root.onPlay) root.onPlay();
  });

  function renderBuyMenu(player) {
    const rows = [];
    for (const [key, item] of BUY_KEYS) {
      let name;
      let price;
      let owned = false;
      if (item === 'armor') {
        name = 'Kevlar Vest';
        price = ARMOR_PRICE;
        owned = player.armor;
      } else if (GRENADES[item]) {
        name = GRENADES[item].name;
        price = GRENADES[item].price;
        owned = player.grenades[item] > 0;
      } else {
        name = WEAPONS[item].name;
        price = WEAPONS[item].price;
        owned = player.weapons[WEAPONS[item].slot]?.def.id === item;
      }
      const afford = player.money >= price;
      const cls = owned ? 'owned' : afford ? '' : 'poor';
      const tag = owned ? 'OWNED' : `$${price}`;
      rows.push(`<li class="${cls}"><kbd>${key.replace('Digit', '')}</kbd><span>${name}</span><b>${tag}</b></li>`);
    }
    root.buyList.innerHTML = rows.join('');
    root.buyMoney.textContent = `$${player.money}`;
  }

  return {
    root,
    onPlay: null,

    announce(title, sub, holdMs = 3400) {
      root.bannerTitle.textContent = title;
      root.bannerSub.textContent = sub || '';
      root.banner.classList.add('on');
      bannerUntil = performance.now() + holdMs;
    },

    kill(text, team) {
      const li = document.createElement('li');
      li.textContent = text;
      li.className = team;
      root.feed.prepend(li);
      while (root.feed.children.length > 5) root.feed.lastChild.remove();
      setTimeout(() => li.classList.add('fade'), 3600);
      setTimeout(() => li.remove(), 4300);
    },

    hitmarker(head) {
      root.hitmarker.classList.toggle('head', !!head);
      root.hitmarker.classList.add('on');
      hitUntil = performance.now() + 110;
    },

    damageFlash() {
      root.vignette.classList.add('on');
      setTimeout(() => root.vignette.classList.remove('on'), 130);
    },

    flashOverlay(strength) {
      root.flash.style.transition = 'none';
      root.flash.style.opacity = String(Math.min(1, strength));
      requestAnimationFrame(() => {
        root.flash.style.transition = 'opacity 2.6s linear';
        root.flash.style.opacity = '0';
      });
    },

    setBuyOpen(open, player) {
      root.buyMenu.classList.toggle('open', open);
      if (open && player) renderBuyMenu(player);
    },

    setProgress(frac, label) {
      if (frac > 0) {
        root.progress.classList.add('on');
        root.progressFill.style.width = `${Math.round(frac * 100)}%`;
        root.progressLabel.textContent = label;
      } else {
        root.progress.classList.remove('on');
      }
    },

    showOverlay(kind, title, copy, button) {
      root.overlay.hidden = false;
      root.overlayTitle.textContent = title;
      root.overlayCopy.textContent = copy;
      root.playButton.textContent = button;
      root.overlay.dataset.kind = kind;
    },
    hideOverlay() {
      root.overlay.hidden = true;
    },

    sync(match, player, now) {
      // clock and phase
      let clock = '';
      let phase = '';
      if (match.phase === 'buy') {
        clock = fmtTime(match.phaseEndsAt - now);
        phase = `BUY — ROUND ${match.round}`;
      } else if (match.phase === 'live') {
        clock = fmtTime(match.phaseEndsAt - now);
        phase = `SITE ${match.targetSite}`;
      } else if (match.phase === 'planted') {
        clock = fmtTime(match.planted.detonatesAt - now);
        phase = 'CHARGE PLANTED';
      } else if (match.phase === 'roundEnd') {
        phase = match.endReason || '';
      } else if (match.phase === 'matchEnd') {
        phase = 'MATCH OVER';
      }
      root.timer.textContent = clock;
      root.phase.textContent = phase;
      root.timer.classList.toggle('danger', match.phase === 'planted');
      root.scoreA.textContent = String(match.score.attack);
      root.scoreD.textContent = String(match.score.defend);
      root.chargeTag.style.display = player.hasCharge && match.phase === 'live' ? 'block' : 'none';

      // body and kit
      const hp = Math.max(0, Math.round(player.health));
      root.healthFill.style.width = `${hp}%`;
      root.healthFill.classList.toggle('low', hp <= 30);
      root.healthText.textContent = String(hp);
      root.armorTag.style.visibility = player.armor ? 'visible' : 'hidden';
      const ws = player.weapons[player.current];
      if (ws) {
        root.ammoMag.textContent = String(ws.mag);
        root.ammoReserve.textContent = `/ ${ws.reserve}`;
        root.weaponName.textContent = ws.def.name + (ws.reloadingUntil > now ? ' — RELOADING' : '');
        root.ammoBox.classList.toggle('empty', ws.mag === 0);
      }
      root.money.textContent = `$${player.money}`;

      // crosshair spread follows the weapon's true spread
      if (ws) {
        const gap = 6 + player.body.speed2d * 2.4 + ws.bloom * 260;
        root.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
      }

      if (now > bannerUntil) root.banner.classList.remove('on');
      if (now > hitUntil) root.hitmarker.classList.remove('on');

      // buy menu contents follow money while open
      if (root.buyMenu.classList.contains('open') && player.money !== lastBuyMoney) {
        lastBuyMoney = player.money;
        renderBuyMenu(player);
      }
      if (match.phase !== lastPhase) {
        lastPhase = match.phase;
        if (match.phase !== 'buy') root.buyMenu.classList.remove('open');
      }

      root.spectate.style.display = !player.alive && (match.phase === 'live' || match.phase === 'planted') ? 'block' : 'none';
    },
  };
}
