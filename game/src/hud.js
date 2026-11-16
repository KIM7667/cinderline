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
    minimap: el('minimap'),
    compassStrip: el('compass-strip'),
    pipsA: el('pips-attack'),
    pipsD: el('pips-defend'),
  };

  let bannerUntil = 0;
  let hitUntil = 0;
  let lastBuyMoney = -1;
  let lastPhase = '';
  let lastMapAt = 0;
  let lastPips = '';

  // The compass strip: three revolutions of tick marks, 14 px per 15°, so
  // sync() can slide the middle revolution under the centre tick by yaw.
  {
    const CARDINALS = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    let html = '';
    for (let rev = 0; rev < 3; rev += 1) {
      for (let deg = 0; deg < 360; deg += 15) {
        const label = CARDINALS[deg];
        if (label) html += `<span class="card${deg === 0 ? ' north' : ''}">${label}</span>`;
        else html += '<span>·</span>';
      }
    }
    root.compassStrip.innerHTML = html;
  }
  const mapCtx = root.minimap.getContext('2d');

  // The tactical minimap: colliders become the yard's floor plan, the sites
  // are ringed and lettered, the called site is lit, a planted charge blinks,
  // and the squad shows as dots with the player as a heading arrow. Enemy
  // positions are never drawn — that is the game's information rule, and the
  // map honours it exactly like the bots' hearing does.
  function drawMinimap(match, player, actors, world, now) {
    const S = 150;
    const k = S / 92;
    const px = (x) => (x + 46) * k;
    const pz = (z) => (z + 46) * k;
    mapCtx.clearRect(0, 0, S, S);
    mapCtx.fillStyle = 'rgba(16,19,23,0.92)';
    mapCtx.fillRect(0, 0, S, S);
    mapCtx.fillStyle = 'rgba(242,240,234,0.20)';
    for (const c of world.colliders) {
      if (c.minY > 0.01 || c.maxY < 1.0) continue; // ground-plan solids only
      mapCtx.fillRect(px(c.minX), pz(c.minZ), (c.maxX - c.minX) * k, (c.maxZ - c.minZ) * k);
    }
    for (const site of [world.sites.A, world.sites.B]) {
      const called = match.targetSite === site.id;
      mapCtx.beginPath();
      mapCtx.arc(px(site.x), pz(site.z), site.radius * k, 0, Math.PI * 2);
      mapCtx.strokeStyle = called ? '#ffb454' : 'rgba(255,180,84,0.45)';
      mapCtx.lineWidth = called ? 2 : 1;
      mapCtx.stroke();
      mapCtx.fillStyle = called ? '#ffb454' : 'rgba(255,180,84,0.6)';
      mapCtx.font = 'bold 11px system-ui, sans-serif';
      mapCtx.textAlign = 'center';
      mapCtx.textBaseline = 'middle';
      mapCtx.fillText(site.id, px(site.x), pz(site.z));
    }
    if (match.planted) {
      const blink = Math.floor(now / 400) % 2 === 0;
      mapCtx.fillStyle = blink ? '#ff4747' : 'rgba(255,71,71,0.35)';
      mapCtx.beginPath();
      mapCtx.arc(px(match.planted.x), pz(match.planted.z), 3.4, 0, Math.PI * 2);
      mapCtx.fill();
    }
    for (const actor of actors) {
      if (!actor.alive || actor.isPlayer || actor.team !== 'attack') continue;
      mapCtx.fillStyle = '#ff7a33';
      mapCtx.beginPath();
      mapCtx.arc(px(actor.body.pos.x), pz(actor.body.pos.z), 2.6, 0, Math.PI * 2);
      mapCtx.fill();
    }
    // the player: a wedge pointing along the view yaw
    const yaw = player.body.yaw;
    const cx = px(player.body.pos.x);
    const cy = pz(player.body.pos.z);
    mapCtx.save();
    mapCtx.translate(cx, cy);
    mapCtx.rotate(-yaw); // the wedge's tip lands on the forward vector (-sin, -cos)
    mapCtx.fillStyle = '#f2f0ea';
    mapCtx.beginPath();
    mapCtx.moveTo(0, -5);
    mapCtx.lineTo(3.4, 4);
    mapCtx.lineTo(-3.4, 4);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }

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

    sync(match, player, now, actors = null, world = null) {
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
        root.weaponName.textContent = ws.def.name
          + (ws.def.auto ? ' · AUTO' : ' · SEMI')
          + (ws.reloadingUntil > now ? ' — RELOADING' : '');
        root.ammoBox.classList.toggle('empty', ws.mag === 0);
      }

      // compass: heading is -yaw in degrees (north is -z, toward the sites);
      // 14 px per 15° puts one revolution at 336 px, strip holds three
      const headingDeg = ((-player.body.yaw * 180) / Math.PI % 360 + 360) % 360;
      const headingPx = (headingDeg / 360) * 336;
      root.compassStrip.style.transform = `translateX(${(-221 - headingPx).toFixed(1)}px)`;

      // squad pips and the minimap follow the actor list when main passes it
      if (actors) {
        const key = actors.map((a) => (a.alive ? '1' : '0')).join('');
        if (key !== lastPips) {
          lastPips = key;
          const render = (team, cls) => actors
            .filter((a) => a.team === team)
            .map((a) => `<span class="pip ${cls}${a.alive ? '' : ' dead'}"></span>`)
            .join('');
          root.pipsA.innerHTML = render('attack', 'a');
          root.pipsD.innerHTML = render('defend', 'd');
        }
        if (world && now - lastMapAt > 120) {
          lastMapAt = now;
          drawMinimap(match, player, actors, world, now);
        }
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
