(function () {
  'use strict';
  var SB = window.SB || {};
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var SESSION = 'mssnFantasySession3';
  var SLIP = 'mssnSportsbookSlip';
  var PREFS = 'mssnSportsbookPrefs';
  var ERRORS = {
    wrong_login: 'Wrong username or password.', no_account: 'No account with that username.', taken: 'That username is taken.',
    bad_account: 'Usernames are 3 to 20 letters, numbers, dots or underscores.', full: 'Sign ups are full right now.',
    not_linked: 'Link your account before betting.', funds: 'Not enough balance for that.', bad_stake: 'Stakes need to be at least 1.',
    same_market: 'You can’t combine two picks from the same market.', related: 'Some of these picks are too closely linked to parlay together.', too_many_legs: 'Parlays can have up to ' + (SB.max_legs || 10) + ' legs.',
    too_long: 'That parlay pays too much. Remove a leg.', cashout_closed: 'Cash out isn’t available for that bet right now.', closed: 'Some picks are no longer available.', server: 'The sportsbook had a problem. Try again.',
    bad_request: 'That didn’t work. Reload the page and try again.', offline: 'Can’t reach the sportsbook right now.'
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function save(key, val) { try { if (val === undefined) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function load(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } }
  function money(v) { return (+v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function odds(a) { return a > 0 ? '+' + a : String(a); }
  function line(v) { return v > 0 ? '+' + v : String(v); }
  function dec(a) { return a > 0 ? 1 + a / 100 : 1 + 100 / -a; }
  function american(d) { return d >= 2 ? Math.round((d - 1) * 100) : -Math.round(100 / (d - 1)); }
  function groupKey(id) { return id.split('|').slice(0, -1).join('|'); }
  function head(key) { return 'https://mc-heads.net/avatar/' + encodeURIComponent(key || 'MHF_Steve') + '/32'; }
  function etParts(ms) {
    var d = new Date(ms);
    return {
      day: d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' }),
      time: d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) + ' ET'
    };
  }
  function until(ms) {
    var s = Math.max(0, Math.round(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + m + 'm' : m + 'm';
  }
  function monthName(m) {
    if (!m) return '';
    var p = m.split('-');
    return new Date(Date.UTC(+p[0], +p[1] - 1, 15)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  var toastTimer;
  function toast(msg) {
    var t = $('[data-toast]');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  function post(url, body) {
    if (!url) return Promise.resolve({ ok: false, error: 'offline' });
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false, error: 'offline' }; });
  }
  function api(body) { return post(SB.api, body); }
  function authed(body) { body.user = session.user; body.hash = session.hash; return api(body); }

  function b64(bytes) { return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))); }
  function randomB64(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64(a); }
  function hashPassword(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: SB.iterations || 310000 }, key, 256);
    }).then(b64);
  }

  var stored = load(SESSION);
  var session = stored && stored.user && stored.hash ? stored : null;
  var prefs = load(PREFS) || {};
  var B = null, ME = null;
  var league = prefs.league || (SB.leagues && SB.leagues[0] ? SB.leagues[0].code : 'MCFL');
  var tab = 'lines', gameId = null, propGroup = 'All', betsTab = 'open', cashConfirm = null, cashing = null;
  var slip = load(SLIP) || { legs: [], mode: 'straight', stakes: {}, parlay: '' };
  var changes = {}, closed = {}, placing = false, slipOpen = false, modal = null;

  function savePrefs() { prefs.league = league; save(PREFS, prefs); }
  function saveSlip() { save(SLIP, slip); }

  function markets() { return (B && B.markets || []).filter(function (m) { return m.start > Date.now(); }); }
  function leagueMarkets() { return markets().filter(function (m) { return m.league === league; }); }
  function findSel(id) {
    var mid = id.split('|')[0];
    var m = markets().filter(function (x) { return x.id === mid; })[0];
    if (!m) return null;
    var s = m.data.sels.filter(function (x) { return x.id === id; })[0];
    return s ? { m: m, s: s } : null;
  }
  function teamName(m, side) { return m.data[side].team; }
  function pickLabel(m, s) {
    if (s.type === 'ml') return teamName(m, s.side);
    if (s.type === 'spread') return teamName(m, s.side) + ' ' + line(s.line);
    if (s.type === 'total') return (s.side === 'over' ? 'Over ' : 'Under ') + s.line;
    if (s.yes || s.label === 'Anytime TD Scorer') return s.player + ' to score a TD';
    return s.player + ' ' + (s.side === 'over' ? 'Over ' : 'Under ') + s.line;
  }
  function marketLabel(m, s) {
    var kind = s.type === 'ml' ? 'Moneyline' : s.type === 'spread' ? 'Spread' : s.type === 'total' ? 'Total Points' : s.label;
    return kind + ' · ' + teamName(m, 'away') + ' @ ' + teamName(m, 'home');
  }
  function clash(a, b) {
    if (a.type === 'prop' && b.type === 'prop' && a.player && a.player === b.player && a.team === b.team) return true;
    if (a.mid !== b.mid) return false;
    var lines = { ml: 1, spread: 1 }, offense = { Passing: 1, Receiving: 1, Rushing: 1, 'TD Scorers': 1 };
    if (lines[a.type] && lines[b.type]) return true;
    if (a.type === 'prop' && b.type === 'prop') {
      var pass = function (x) { return x.group === 'Passing'; };
      var catches = function (x) { return x.group === 'Receiving' || x.group === 'TD Scorers'; };
      return a.team === b.team && ((pass(a) && catches(b)) || (pass(b) && catches(a)));
    }
    var prop = a.type === 'total' ? b : b.type === 'total' ? a : null;
    return !!(prop && prop.type === 'prop' && offense[prop.group]);
  }
  function legInfo(l) {
    var f = findSel(l.id);
    return f ? { mid: f.m.id, type: f.s.type, player: f.s.player, team: f.s.team, group: f.s.group, pick: l.pick } : null;
  }
  function inSlip(id) { return slip.legs.some(function (l) { return l.id === id; }); }

  function toggle(id) {
    var f = findSel(id);
    if (!f) return;
    if (inSlip(id)) {
      slip.legs = slip.legs.filter(function (l) { return l.id !== id; });
      delete slip.stakes[id];
    } else {
      var g = groupKey(id);
      slip.legs = slip.legs.filter(function (l) {
        if (groupKey(l.id) === g) { delete slip.stakes[l.id]; return false; }
        return true;
      });
      if (slip.legs.length >= 20) { toast('Your bet slip is full.'); return; }
      slip.legs.push({ id: id, odds: f.s.odds, pick: pickLabel(f.m, f.s), market: marketLabel(f.m, f.s), mid: f.m.id });
      if (slip.legs.length === 2 && slip.mode === 'straight' && !Object.keys(slip.stakes).some(function (k) { return +slip.stakes[k] > 0; })) slip.mode = 'parlay';
    }
    if (slip.legs.length < 2) slip.mode = 'straight';
    delete changes[id]; delete closed[id];
    saveSlip(); renderSlip(); paintButtons();
  }

  function refreshSlipOdds() {
    slip.legs.forEach(function (l) {
      var f = findSel(l.id);
      if (!f) { closed[l.id] = true; return; }
      delete closed[l.id];
      if (f.s.odds !== l.odds) { changes[l.id] = l.odds; l.odds = f.s.odds; }
      l.pick = pickLabel(f.m, f.s);
    });
  }

  function oddBtn(s, label, only) {
    if (!s) return '<span class="sb-odd off"><span class="o">–</span></span>';
    return '<button type="button" class="sb-odd' + (only ? ' only' : '') + (inSlip(s.id) ? ' on' : '') + '" data-sel="' + esc(s.id) + '">' +
      (label ? '<span class="l">' + esc(label) + '</span>' : '') + '<span class="o">' + odds(s.odds) + '</span></button>';
  }
  function paintButtons() {
    $$('[data-sel]').forEach(function (b) { b.classList.toggle('on', inSlip(b.getAttribute('data-sel'))); });
  }

  function logo(t, big) {
    var src = t.logo ? (/^https?:/.test(t.logo) ? t.logo : (SB.root || '../') + t.logo) : '';
    return '<span class="sb-logo' + (big ? ' big' : '') + '" style="--c:' + esc(t.color || '#555') + '"><span class="sb-logo-l">' + esc((t.team || '?').charAt(0)) + '</span>' +
      (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  }
  function kickoff(m) {
    var t = etParts(m.start);
    if (!m.data.when) return 'Time TBD';
    return m.data.time_known === false ? t.day + ' · Time TBD' : t.day + ' · ' + t.time;
  }
  function sel(m, type, side) { return m.data.sels.filter(function (s) { return s.type === type && s.side === side; })[0]; }
  function propCount(m) {
    var seen = {};
    m.data.sels.forEach(function (s) { if (s.type === 'prop') seen[groupKey(s.id)] = 1; });
    return Object.keys(seen).length;
  }
  function teamStyle(m) { return '--ca:' + esc(m.data.away.color || '#555') + ';--ch:' + esc(m.data.home.color || '#555'); }

  function linesRows(m) {
    var html = '';
    ['away', 'home'].forEach(function (side) {
      var tm = m.data[side], sp = sel(m, 'spread', side), tot = sel(m, 'total', side === 'away' ? 'over' : 'under');
      html += '<div class="sb-game-row"><a class="sb-team" href="#game/' + esc(encodeURIComponent(m.id)) + '">' + logo(tm) + '<span class="sb-team-name">' +
        esc(tm.team) + '<span class="sb-team-rec">' + esc(tm.record || '') + '</span></span></a>' +
        oddBtn(sp, sp ? line(sp.line) : '') + oddBtn(tot, tot ? (tot.side === 'over' ? 'O ' : 'U ') + tot.line : '') + oddBtn(sel(m, 'ml', side), '', true) + '</div>';
    });
    return html;
  }

  function viewLines() {
    var ms = leagueMarkets();
    if (!SB.api) return '<div class="sb-empty"><strong>The sportsbook isn’t open yet</strong>Its server hasn’t been set up.</div>';
    if (!B) return '<div class="sb-empty">Loading the board…</div>';
    if (!ms.length) return '<div class="sb-empty"><strong>No lines on the board</strong>Every game this week has kicked off. Next week’s lines go up soon.</div>';
    var html = '', day = null;
    ms.forEach(function (m) {
      var t = etParts(m.start), tbd = !m.data.when;
      var head = tbd ? 'Week ' + m.week + ' · Time TBD' : t.day;
      if (head !== day) { day = head; html += '<div class="sb-day"><span>' + esc(day) + '</span></div>'; }
      var n = propCount(m);
      html += '<article class="sb-game" style="' + teamStyle(m) + '"><div class="sb-game-head"><span>' +
        (m.data.gotw ? '<span class="sb-gotw">★ Game of the Week</span>' : 'Week ' + m.week) +
        '</span><span>Spread</span><span>Total</span><span>Money</span></div>' + linesRows(m) +
        '<a class="sb-game-foot" href="#game/' + esc(encodeURIComponent(m.id)) + '"><span>' + esc(tbd ? 'Kickoff time not posted yet' : kickoff(m)) + '</span>' +
        '<span class="sb-more">' + (n ? n + ' player props' : 'Game details') + ' <b>›</b></span></a></article>';
    });
    return html;
  }

  var CATS = ['TD Scorers', 'Passing', 'Receiving', 'Rushing', 'Defense'];
  var MARKET_ORDER = ['Anytime TD Scorer', 'Passing Yards', 'Passing TDs', 'Receiving Yards', 'Receptions', 'Rushing Yards', 'Tackles', 'Sacks', 'Interceptions'];

  function propRows(m, label) {
    var rows = {};
    m.data.sels.filter(function (s) { return s.type === 'prop' && s.label === label; }).forEach(function (s) {
      var k = s.player + '|' + s.team;
      (rows[k] = rows[k] || { player: s.player, team: s.team, head: s.head, avg: s.avg, gp: s.gp, yes: s.yes })[s.side] = s;
    });
    return Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) {
      if (a.yes) return a.over.odds - b.over.odds;
      var ta = a.team === m.away ? 0 : 1, tb = b.team === m.away ? 0 : 1;
      return ta - tb || ((b.over || b.under).line - (a.over || a.under).line);
    });
  }

  function marketBlock(m, label) {
    var list = propRows(m, label);
    if (!list.length) return '';
    var yes = list[0].yes;
    var html = '<section class="sb-market"><div class="sb-market-title">' + esc(label) + '</div><div class="sb-props-cols' + (yes ? ' one' : '') + '"><span>Player</span>' +
      (yes ? '<span>Yes</span>' : '<span>Over</span><span>Under</span>') + '</div>';
    list.forEach(function (r) {
      var o = r.over, u = r.under, side = r.team === m.data.home.team ? 'home' : 'away';
      var meta = yes ? esc(r.team) + ' · <b>' + o.hit + '/' + r.gp + '</b> games with a TD' :
        esc(r.team) + ' · Avg <b>' + esc(r.avg) + '</b>' + (o ? ' · Over in <b>' + o.hit + '/' + r.gp + '</b>' : '');
      html += '<div class="sb-prop' + (yes ? ' one' : '') + '"><div class="sb-player"><span class="sb-head-wrap" style="--c:' + esc(m.data[side].color || '#555') + '"><img class="sb-head" src="' + esc(head(r.head)) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'"></span>' +
        '<div style="min-width:0"><div class="sb-player-name">' + esc(r.player) + '</div><div class="sb-player-meta">' + meta + '</div></div></div>' +
        (yes ? oddBtn(o, '') : oddBtn(o, o ? 'O ' + o.line : '') + oddBtn(u, u ? 'U ' + u.line : '')) + '</div>';
    });
    return html + '</section>';
  }

  function viewGame() {
    if (!B) return '<div class="sb-empty">Loading the game…</div>';
    var m = markets().filter(function (x) { return x.id === gameId; })[0];
    if (!m) return '<div class="sb-empty"><strong>This game is off the board</strong>It has kicked off or been logged.<br><br><a class="btn btn-sm" href="#lines" data-tab="lines">Back to all games</a></div>';
    if (m.league !== league) { league = m.league; savePrefs(); }
    var pa = Math.round((m.data.prob_away || 0.5) * 100), proj = m.data.proj || {};
    var team = function (side) {
      var tm = m.data[side];
      return '<div class="sb-hero-team ' + side + '">' + logo(tm, true) + '<div class="sb-hero-name">' + esc(tm.team) + '</div><div class="sb-hero-rec">' + esc(tm.record || '') +
        (proj[side] != null ? ' · Proj ' + Math.round(proj[side]) : '') + '</div></div>';
    };
    var html = '<a class="sb-back" href="#lines" data-tab="lines">‹ All games</a>' +
      '<section class="sb-hero" style="' + teamStyle(m) + '"><div class="sb-hero-top">' + esc(m.league + ' · Week ' + m.week) + (m.data.gotw ? ' · <span class="sb-gotw">★ Game of the Week</span>' : '') + '</div>' +
      '<div class="sb-hero-row">' + team('away') + '<div class="sb-hero-mid"><span class="sb-at">@</span><span>' + esc(kickoff(m)) + '</span></div>' + team('home') + '</div>' +
      '<div class="sb-prob"><span>' + pa + '%</span><div class="sb-prob-bar"><i style="width:' + pa + '%"></i></div><span>' + (100 - pa) + '%</span></div>' +
      '<div class="sb-prob-cap">Win probability</div></section>' +
      '<article class="sb-game sb-game-lines" style="' + teamStyle(m) + '"><div class="sb-game-head"><span>Game Lines</span><span>Spread</span><span>Total</span><span>Money</span></div>' + linesRows(m) + '</article>';
    var cats = CATS.filter(function (c) { return m.data.sels.some(function (s) { return s.type === 'prop' && s.group === c; }); });
    if (!cats.length) return html + '<div class="sb-empty"><strong>No player props for this game</strong>There aren’t enough games logged for these players yet.</div>';
    if (propGroup !== 'All' && cats.indexOf(propGroup) < 0) propGroup = 'All';
    html += '<div class="sb-cats">' + ['All'].concat(cats).map(function (c) {
      return '<button type="button" class="sb-cat' + (c === propGroup ? ' on' : '') + '" data-pgroup="' + esc(c) + '">' + esc(c) + '</button>';
    }).join('') + '</div>';
    (propGroup === 'All' ? cats : [propGroup]).forEach(function (c) {
      var labels = MARKET_ORDER.filter(function (l) { return m.data.sels.some(function (s) { return s.type === 'prop' && s.group === c && s.label === l; }); });
      if (propGroup === 'All') html += '<h2 class="sb-cat-title">' + esc(c) + '</h2>';
      labels.forEach(function (l) { html += marketBlock(m, l); });
    });
    return html;
  }

  function betCard(b) {
    var parlay = b.legs.length > 1;
    var status = b.status === 'open' ? (b.legs.some(function (l) { return l.status !== 'open'; }) ? 'Live' : 'Open') :
      b.status === 'won' ? 'Won' : b.status === 'lost' ? 'Lost' : b.status === 'cashed' ? 'Cashed Out' : 'Void';
    var html = '<article class="sb-bet"><div class="sb-bet-head"><span class="sb-bet-kind">' + (parlay ? b.legs.length + ' Leg Parlay' : 'Straight') +
      '<span>' + odds(american(b.odds)) + '</span></span><span class="sb-pill ' + esc(b.status) + '">' + status + '</span></div>';
    b.legs.forEach(function (l) {
      var mark = l.status === 'won' ? '✓' : l.status === 'lost' ? '✕' : l.status === 'void' ? '–' : '';
      var fake = { data: { away: { team: l.away }, home: { team: l.home } } };
      var pick = pickLabel(fake, l), mkt = marketLabel(fake, l);
      var actual = l.actual == null ? '' : l.type === 'ml' || l.type === 'spread' ? ' · Final ' + l.actual : ' · Result ' + l.actual;
      html += '<div class="sb-bet-leg"><span class="sb-dot ' + esc(l.status) + '">' + mark + '</span><div><div class="sb-leg-pick">' + esc(pick) + '</div>' +
        '<div class="sb-leg-mkt">' + esc(mkt) + esc(actual) + (l.status === 'void' ? ' · Void' : '') + '</div></div><span class="sb-leg-odds">' + odds(l.odds) + '</span></div>';
    });
    var placed = new Date(b.placed).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    var right = b.status === 'open' ? '<div class="win">To win<strong>' + money(b.stake * b.odds - b.stake) + '</strong></div>' :
      '<div class="' + (b.status === 'won' ? 'win' : '') + '">Payout<strong>' + money(b.payout) + '</strong></div>';
    var cash = '';
    if (b.status === 'open' && b.cashout) {
      if (b.cashout.value != null) {
        var sure = cashConfirm === b.id;
        cash = '<button type="button" class="sb-cashout' + (sure ? ' sure' : '') + '" data-cashout="' + esc(b.id) + '" data-value="' + b.cashout.value + '"' + (cashing ? ' disabled' : '') + '>' +
          (cashing === b.id ? 'Cashing out…' : (sure ? 'Confirm cash out ' : 'Cash out ') + money(b.cashout.value)) + '</button>';
      } else {
        cash = '<div class="sb-cashout off">' + (b.cashout.reason === 'live' ? 'Cash out is paused while a game in this bet is live' :
          b.cashout.reason === 'moved' ? 'Cash out isn’t available because a line in this bet moved' : 'Cash out isn’t available for this bet') + '</div>';
      }
    }
    return html + '<div class="sb-bet-foot"><div>Wager<strong>' + money(b.stake) + '</strong><span>' + esc(placed) + '</span></div>' + right + '</div>' + cash + '</article>';
  }

  function cashOut(id, value) {
    if (cashing) return;
    if (cashConfirm !== id) { cashConfirm = id; renderView(); return; }
    cashing = id; renderView();
    authed({ action: 'cashout', id: id, value: value }).then(function (r) {
      cashing = null; cashConfirm = null;
      if (r.ok) { ME = r; renderAccount(); toast('Cashed out ' + money(value) + '.'); }
      else if (r.error === 'cashout_changed') { toast('The cash out value changed to ' + money(r.value) + '. Tap again to take it.'); loadMe(); }
      else toast(ERRORS[r.error] || ERRORS.server);
      renderView(); renderSlip();
    });
  }

  function viewBets() {
    if (!session) return '<div class="sb-empty"><strong>Sign in to see your bets</strong><br><button type="button" class="btn btn-green" data-act="signin">Sign in</button></div>';
    if (!ME) return '<div class="sb-empty">Loading your bets…</div>';
    if (!ME.link.linked) return linkCard();
    var bets = ME.bets || [];
    var open = bets.filter(function (b) { return b.status === 'open'; }), done = bets.filter(function (b) { return b.status !== 'open'; });
    var list = betsTab === 'open' ? open : done;
    return '<div class="sb-chips"><button type="button" class="sb-chip' + (betsTab === 'open' ? ' on' : '') + '" data-btab="open">Open <span class="n">' + open.length + '</span></button>' +
      '<button type="button" class="sb-chip' + (betsTab === 'done' ? ' on' : '') + '" data-btab="done">Settled <span class="n">' + done.length + '</span></button></div>' +
      (list.length ? list.map(betCard).join('') : '<div class="sb-empty"><strong>' + (betsTab === 'open' ? 'No open bets' : 'No settled bets yet') + '</strong>' +
        (betsTab === 'open' ? 'Pick a line to get started.' : 'Bets show here once their games are logged.') + '</div>');
  }

  function boardTable(rows, mine) {
    if (!rows.length) return '<div class="sb-empty"><strong>No bettors yet</strong>Place a bet to get on the board.</div>';
    var start = SB.start || 1000;
    return '<table class="sb-board"><thead><tr><th>#</th><th>Player</th><th class="r hide-sm">Record</th><th class="r">Balance</th><th class="r hide-sm">Profit</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var p = r.balance - start;
        return '<tr class="' + (r.rank <= 3 ? 'top3 ' : '') + (mine && r.ign === mine ? 'me' : '') + '"><td class="rank">' + r.rank + '</td><td><span class="who"><img class="sb-head" src="' +
          esc(head(r.uuid || r.ign)) + '" alt="" loading="lazy">' + esc(r.ign) + '</span></td><td class="r hide-sm">' + r.won + '-' + r.lost + (r.open ? ' <span style="color:var(--dim)">(' + r.open + ' open)</span>' : '') +
          '</td><td class="r bal">' + money(r.balance) + '</td><td class="r hide-sm ' + (p > 0 ? 'sb-up' : p < 0 ? 'sb-down' : '') + '">' + (p > 0 ? '+' : '') + money(p) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function viewStandings() {
    if (!B) return '<div class="sb-empty">Loading the standings…</div>';
    var mine = ME && ME.link && ME.link.ign;
    var html = '<h1 class="sb-h1">' + esc(monthName(B.month)) + ' Standings</h1><p class="sb-sub">Top 25 balances. Everyone starts the month with ' + money(SB.start || 1000) +
      '. The top bettors at the end of the month win in-game rewards.</p><div class="sb-reset">Balances reset in <strong>' + until(B.reset - Date.now()) + '</strong></div>';
    if (ME && ME.link && ME.link.linked && ME.balance != null) {
      html += '<div class="sb-card"><h3>You</h3>Balance <strong>' + money(ME.balance) + '</strong>' + (ME.rank ? ' · Rank <strong>#' + ME.rank + '</strong>' : ' · Place a bet to get ranked') + '</div>';
    }
    html += '<div class="sb-board-wrap">' + boardTable(B.standings || [], mine) + '</div>';
    if (B.last && B.last.standings && B.last.standings.length) {
      html += '<h2 class="sb-h1" style="font-size:22px">' + esc(monthName(B.last.month)) + ' Final</h2><div class="sb-board-wrap">' + boardTable(B.last.standings, mine) + '</div>';
    }
    return html;
  }

  function viewRules() {
    var s = money(SB.start || 1000);
    return '<div class="sb-card sb-rules"><h1 class="sb-h1">House Rules</h1>' +
      '<h3>Balance</h3><ul><li>Everyone starts each month with <b>' + s + '</b>. It’s play money: there’s nothing to buy and nothing to cash out.</li>' +
      '<li>Balances reset on the 1st of every month at midnight UTC. The top 25 balances are on the Standings page, and the top bettors at the end of the month win in-game rewards.</li>' +
      '<li>Bets count toward the month you placed them in, even if the game is played after the reset.</li></ul>' +
      '<h3>Who can bet</h3><ul><li>You need a website account linked to your Discord, and your Discord linked to your Minecraft name with <code>/link</code>.</li></ul>' +
      '<h3>Lines and odds</h3><ul><li>Spreads, totals and moneylines come from the same prediction model as the bot’s <code>/prediction</code>. Player props use the bot’s <code>/overunder</code> formula: the player’s average this season, adjusted for the opponent. Anytime TD counts receiving and rushing touchdowns.</li>' +
      '<li>Lines move as games get logged. Your bet keeps the odds you placed it at.</li><li>Every game in the current week is on the board. Once they’ve all kicked off, the next week goes up. Betting on a game closes at its posted kickoff time, or as soon as it’s logged if no time was posted.</li></ul>' +
      '<h3>Parlays</h3><ul><li>Combine up to ' + (SB.max_legs || 10) + ' picks from any games, including game lines and player props from the same game. You can’t take both sides of the same line.</li><li>Picks that move together can’t go in the same parlay: a spread and moneyline from the same game, two props on the same player, a quarterback’s passing prop with a receiving or TD prop from his own team, or a game total with an offensive prop from that game. Bet them straight instead.</li>' +
      '<li>Every leg has to win. A void leg drops out and the parlay pays at the remaining odds.</li></ul>' +
      '<h3>Cash out</h3><ul><li>Open bets can be cashed out from My Bets for their current value: what the bet is worth at today’s odds, minus a 10% fee. Legs that already won count in full.</li>' +
      '<li>Cash out pauses while any game in the bet is live, and isn’t offered if a line in the bet has moved since you placed it.</li><li>Cashing out settles the bet right away and can’t be undone.</li></ul>' +
      '<h3>Settling</h3><ul><li>Bets settle a minute or two after the game is logged.</li>' +
      '<li>Forfeited games are void. A player prop is void if that player doesn’t play. A game that still isn’t logged 10 days after kickoff is void.</li><li>A tie on a moneyline is a push and is refunded.</li></ul></div>';
  }

  function linkCard() {
    var l = ME && ME.link || {};
    var code = ME && ME.code;
    var noIgn = l.discord && !l.ign;
    return '<div class="sb-card"><h3>Link your account to bet</h3><p style="color:var(--muted);margin:0">Your website account, Discord and Minecraft name all need to be linked.</p><ol class="sb-steps">' +
      '<li class="' + (l.ign ? 'done' : '') + '">In the league Discord, run <code>/link</code> with your Minecraft username.' + (noIgn ? '<div class="sb-leg-warn">Your Discord is linked here but has no Minecraft name. Run <code>/link</code> again.</div>' : '') + '</li>' +
      '<li class="' + (code || l.discord ? 'done' : '') + '">' + (code ? 'Your code: <div><span class="sb-code">' + esc(code.code) + '</span></div><span style="color:var(--muted);font-size:12px">Expires in ' + until(code.expires - Date.now()) + '</span>' :
        '<button type="button" class="btn btn-green btn-sm" data-act="code">Get a link code</button>') + '</li>' +
      '<li class="' + (l.linked ? 'done' : '') + '">Run <code>/sitelink' + (code ? ' ' + esc(code.code) : '') + '</code> in the Discord. This page updates by itself.</li></ol></div>';
  }

  function renderView() {
    var v = $('[data-view]');
    $$('.sb-nav-row a').forEach(function (a) { a.classList.toggle('on', a.getAttribute('data-tab') === (tab === 'game' ? 'lines' : tab)); });
    $('[data-leagues]').hidden = tab !== 'lines';
    v.innerHTML = tab === 'game' ? viewGame() : tab === 'bets' ? viewBets() : tab === 'standings' ? viewStandings() : tab === 'rules' ? viewRules() : viewLines();
    renderLeagues();
  }

  function renderLeagues() {
    var el = $('[data-leagues]');
    el.innerHTML = (SB.leagues || []).map(function (lg) {
      var n = markets().filter(function (m) { return m.league === lg.code; }).length;
      return '<button type="button" class="sb-chip' + (lg.code === league ? ' on' : '') + '" data-league="' + esc(lg.code) + '">' + esc(lg.code) + ' <span class="n">' + n + '</span></button>';
    }).join('');
  }

  function renderAccount() {
    var el = $('[data-account]');
    if (!session) { el.innerHTML = '<button type="button" class="btn btn-sm" data-act="signin">Log in</button><button type="button" class="btn btn-green btn-sm" data-act="signup">Sign up</button>'; return; }
    var bal = ME && ME.link && ME.link.discord && ME.balance != null ? '<div class="sb-balance"><span>Balance</span><strong>' + money(ME.balance) + '</strong></div>' : '';
    var who = ME && ME.link && ME.link.ign ? ME.link.ign : session.user;
    el.innerHTML = bal + '<button type="button" class="sb-user" data-act="menu"><img src="' + esc(head(ME && ME.link && (ME.link.uuid || ME.link.ign) || 'MHF_Steve')) + '" alt="" onerror="this.style.visibility=\'hidden\'"><span>' + esc(who) + '</span></button>';
    var open = ME && ME.bets ? ME.bets.filter(function (b) { return b.status === 'open'; }).length : 0;
    var badge = $('[data-open-count]');
    badge.hidden = !open; badge.textContent = open;
  }

  function stakeOf(v) { var n = parseFloat(v); return Number.isFinite(n) && n > 0 ? Math.floor(n * 100) / 100 : 0; }

  function renderSlip() {
    var el = $('[data-slip]'), n = slip.legs.length;
    refreshSlipOdds();
    var conflict = false, mids = {};
    var parlayOk = n >= 2 && n <= (SB.max_legs || 10);
    if (slip.mode === 'parlay' && !parlayOk) slip.mode = 'straight';
    var html = '<div class="sb-slip-head"><h2>Bet Slip' + (n ? '<span class="n">' + n + '</span>' : '') + '</h2>' +
      (n ? '<button type="button" class="sb-clear" data-act="clear">Remove all</button>' : '') +
      '<button type="button" class="sb-x" data-act="closeslip" style="position:static" aria-label="Close bet slip">&times;</button></div>';
    if (!n) {
      html += '<div class="sb-slip-list"><div class="sb-slip-empty"><strong>Your bet slip is empty</strong>Tap any odds to add a pick. Add two or more to build a parlay.</div></div>';
      el.innerHTML = html; renderBar(); return;
    }
    html += '<div class="sb-slip-tabs"><button type="button" data-mode="straight" class="' + (slip.mode === 'straight' ? 'on' : '') + '">Straight</button>' +
      '<button type="button" data-mode="parlay" class="' + (slip.mode === 'parlay' ? 'on' : '') + '"' + (parlayOk ? '' : ' disabled') + '>Parlay' + (n >= 2 ? ' (' + n + ')' : '') + '</button></div>';
    html += '<div class="sb-slip-list">';
    var anyChange = Object.keys(changes).length, anyClosed = Object.keys(closed).length;
    if (anyClosed) html += '<div class="sb-alert red">Some picks are closed. Remove them to place your bet.</div>';
    else if (anyChange) html += '<div class="sb-alert">Odds changed on ' + anyChange + ' pick' + (anyChange > 1 ? 's' : '') + '. Review them and place again.</div>';
    var totalStake = 0, totalWin = 0, related = {};
    if (slip.mode === 'parlay') {
      var info = slip.legs.map(legInfo);
      info.forEach(function (a, i) {
        info.forEach(function (b, j) {
          if (i !== j && a && b && clash(a, b) && !related[slip.legs[i].id]) related[slip.legs[i].id] = b.pick;
        });
      });
      if (Object.keys(related).length) {
        conflict = true;
        html += '<div class="sb-alert red">Some picks are too closely linked to parlay together, like a spread and moneyline from the same game or two bets on the same player. Remove one, or bet them straight.</div>';
      }
    }
    slip.legs.forEach(function (l) {
      var was = changes[l.id];
      html += '<div class="sb-leg' + (closed[l.id] || related[l.id] ? ' bad' : '') + '"><div class="sb-leg-top"><div class="sb-leg-pick">' + esc(l.pick) + '</div><div class="sb-leg-odds">' +
        (was != null ? '<s>' + odds(was) + '</s>' : '') + odds(l.odds) + '</div></div><div class="sb-leg-mkt">' + esc(l.market) + '</div>' +
        (closed[l.id] ? '<div class="sb-leg-warn">No longer available</div>' : '') +
        (related[l.id] ? '<div class="sb-leg-warn">Can’t parlay with ' + esc(related[l.id]) + '</div>' : '');
      if (slip.mode === 'straight') {
        var st = stakeOf(slip.stakes[l.id]), win = st * dec(l.odds) - st;
        totalStake += st; totalWin += win;
        html += '<div class="sb-stake"><div class="sb-field"><label>Wager</label><input inputmode="decimal" placeholder="0.00" data-stake="' + esc(l.id) + '" value="' + esc(slip.stakes[l.id] || '') + '"></div>' +
          '<div class="sb-field"><label>To win</label><output data-win="' + esc(l.id) + '">' + money(win) + '</output></div></div>';
      }
      html += '<button type="button" class="sb-leg-x" data-remove="' + esc(l.id) + '" aria-label="Remove">&times;</button></div>';
      if (mids[groupKey(l.id)]) conflict = true;
      mids[groupKey(l.id)] = 1;
    });
    html += '</div><div class="sb-slip-foot">';
    if (slip.mode === 'parlay') {
      var d = slip.legs.reduce(function (x, l) { return x * dec(l.odds); }, 1);
      var ps = stakeOf(slip.parlay);
      totalStake = ps; totalWin = ps * d - ps;
      html += '<div class="sb-parlay-odds"><span>' + n + ' Leg Parlay</span><span data-podds>' + odds(american(d)) + '</span></div>' +
        '<div class="sb-stake" style="margin-top:0"><div class="sb-field"><label>Wager</label><input inputmode="decimal" placeholder="0.00" data-pstake value="' + esc(slip.parlay || '') + '"></div>' +
        '<div class="sb-field"><label>To win</label><output data-pwin>' + money(totalWin) + '</output></div></div>' +
        '<div class="sb-quick">' + [10, 25, 50, 100].map(function (v) { return '<button type="button" data-quick="' + v + '">+' + v + '</button>'; }).join('') + '<button type="button" data-quick="max">Max</button></div>';
      if (d > 1001) html += '<div class="sb-leg-warn">That parlay pays too much. Remove a leg.</div>';
    }
    html += '<div style="margin-top:12px"><div class="sb-sum"><span>Total wager</span><strong data-tstake>' + money(totalStake) + '</strong></div>' +
      '<div class="sb-sum"><span>Total payout</span><strong class="win" data-twin>' + money(totalStake + totalWin) + '</strong></div></div>';
    var btn;
    if (!session) btn = '<button type="button" class="btn btn-green btn-block" data-act="signin">Log in to bet</button>';
    else if (!ME) btn = '<button type="button" class="btn btn-green btn-block" disabled>Loading…</button>';
    else if (!ME.link.linked) btn = '<button type="button" class="btn btn-green btn-block" data-act="link">Link your account to bet</button>';
    else btn = '<button type="button" class="btn btn-green btn-block" data-act="place"' + (placing || anyClosed || conflict || !totalStake ? ' disabled' : '') + '>' +
      (placing ? 'Placing…' : anyChange ? 'Accept odds and place bet' : 'Place bet ' + (totalStake ? money(totalStake) : '')) + '</button>';
    html += btn + (ME && ME.link && ME.link.linked ? '<div class="sb-note">Balance ' + money(ME.balance) + '</div>' : '') + '</div>';
    el.innerHTML = html;
    el.classList.toggle('open', slipOpen);
    renderBar();
  }

  function updateTotals() {
    var totalStake = 0, totalWin = 0;
    if (slip.mode === 'parlay') {
      var d = slip.legs.reduce(function (x, l) { return x * dec(l.odds); }, 1), ps = stakeOf(slip.parlay);
      totalStake = ps; totalWin = ps * d - ps;
      var pw = $('[data-pwin]'); if (pw) pw.textContent = money(totalWin);
    } else {
      slip.legs.forEach(function (l) {
        var st = stakeOf(slip.stakes[l.id]), win = st * dec(l.odds) - st;
        totalStake += st; totalWin += win;
        var o = $('[data-win="' + l.id.replace(/"/g, '\\"') + '"]'); if (o) o.textContent = money(win);
      });
    }
    var a = $('[data-tstake]'), b = $('[data-twin]');
    if (a) a.textContent = money(totalStake);
    if (b) b.textContent = money(totalStake + totalWin);
    var p = $('[data-act="place"]');
    if (p) {
      var anyChange = Object.keys(changes).length;
      p.disabled = placing || !totalStake || Object.keys(closed).length > 0;
      p.textContent = anyChange ? 'Accept odds and place bet' : 'Place bet ' + (totalStake ? money(totalStake) : '');
    }
  }

  function renderBar() {
    var bar = $('[data-slip-bar]'), n = slip.legs.length;
    bar.hidden = !n || slipOpen;
    var label = n >= 2 && slip.mode === 'parlay' ? odds(american(slip.legs.reduce(function (x, l) { return x * dec(l.odds); }, 1))) : '';
    bar.innerHTML = '<span><span class="n">' + n + '</span>Bet Slip</span><span>' + (label ? n + ' Leg Parlay ' + label : 'View') + '</span>';
  }

  function place() {
    if (placing || !session || !ME || !ME.link.linked) return;
    var bets;
    if (slip.mode === 'parlay') {
      var st = stakeOf(slip.parlay);
      if (!st) return toast('Enter a wager.');
      bets = [{ stake: st, legs: slip.legs.map(function (l) { return { id: l.id, odds: l.odds }; }) }];
    } else {
      bets = slip.legs.filter(function (l) { return stakeOf(slip.stakes[l.id]); }).map(function (l) {
        return { stake: stakeOf(slip.stakes[l.id]), legs: [{ id: l.id, odds: l.odds }] };
      });
      if (!bets.length) return toast('Enter a wager.');
    }
    placing = true; renderSlip();
    authed({ action: 'place', bets: bets }).then(function (r) {
      placing = false;
      if (r.ok) {
        ME = r;
        var placedIds = {};
        bets.forEach(function (b) { b.legs.forEach(function (l) { placedIds[l.id] = 1; }); });
        if (slip.mode === 'parlay') slip = { legs: [], mode: 'straight', stakes: {}, parlay: '' };
        else { slip.legs = slip.legs.filter(function (l) { return !placedIds[l.id]; }); bets.forEach(function (b) { delete slip.stakes[b.legs[0].id]; }); }
        changes = {}; closed = {}; saveSlip();
        toast(r.placed > 1 ? r.placed + ' bets placed' : 'Bet placed');
        slipOpen = slip.legs.length > 0 && slipOpen;
        renderAccount(); renderSlip(); renderView();
        return;
      }
      if (r.error === 'odds_changed') {
        Object.keys(r.changes || {}).forEach(function (id) {
          slip.legs.forEach(function (l) { if (l.id === id) { changes[id] = l.odds; l.odds = r.changes[id]; } });
        });
        saveSlip(); loadBoard();
      } else if (r.error === 'closed') {
        (r.closed || []).forEach(function (id) { closed[id] = true; });
        loadBoard();
      } else {
        toast(ERRORS[r.error] || ERRORS.server);
        if (r.error === 'wrong_login') signOut();
      }
      renderSlip();
    });
  }

  function openModal(html) {
    $('[data-modal-body]').innerHTML = html;
    $('[data-modal]').hidden = false;
    var f = $('[data-modal] input'); if (f) f.focus();
  }
  function closeModal() { $('[data-modal]').hidden = true; modal = null; }

  function authModal(kind) {
    modal = 'auth';
    var up = kind === 'signup';
    openModal('<h2>' + (up ? 'Sign up' : 'Log in') + '</h2><p>' + (up ? 'One account works for the whole site: fantasy, the 17–0 Challenge and the sportsbook.' : 'Use your league website account.') + '</p>' +
      '<form class="sb-form" data-auth="' + kind + '"><input name="user" autocomplete="username" placeholder="Username" maxlength="20" required>' +
      '<input name="pass" type="password" autocomplete="' + (up ? 'new-password' : 'current-password') + '" placeholder="Password" minlength="' + (up ? 6 : 1) + '" required>' +
      (up ? '<input name="pass2" type="password" autocomplete="new-password" placeholder="Confirm password" required>' : '') +
      '<div class="err" data-err></div><button class="btn btn-green btn-block" type="submit">' + (up ? 'Create account' : 'Log in') + '</button></form>' +
      '<div class="sb-switch">' + (up ? 'Have an account? <button type="button" class="link" data-act="signin">Log in</button>' : 'New here? <button type="button" class="link" data-act="signup">Sign up</button>') + '</div>');
  }

  function submitAuth(form) {
    var kind = form.getAttribute('data-auth'), user = form.user.value.trim(), pass = form.pass.value, err = $('[data-err]', form);
    var btn = $('button[type=submit]', form);
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(user)) { err.textContent = ERRORS.bad_account; return; }
    if (kind === 'signup' && pass !== form.pass2.value) { err.textContent = 'Passwords don’t match.'; return; }
    if (kind === 'signup' && pass.length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
    btn.disabled = true; err.textContent = '';
    var go;
    if (kind === 'signup') {
      var salt = randomB64(16);
      go = hashPassword(pass, salt).then(function (hash) {
        return post(SB.accounts, { action: 'register', user: user, salt: salt, hash: hash }).then(function (r) {
          if (!r.ok) throw new Error(r.error);
          return hash;
        });
      });
    } else {
      go = post(SB.accounts, { action: 'salt', user: user }).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        return hashPassword(pass, r.salt);
      });
    }
    go.then(function (hash) {
      return api({ action: 'me', user: user, hash: hash }).then(function (r) {
        if (!r.ok) throw new Error(r.error);
        var old = load(SESSION) || {};
        session = { user: r.user || user, hash: hash, league: old.user && old.user.toLowerCase() === user.toLowerCase() ? old.league : null };
        save(SESSION, session);
        ME = r; closeModal(); renderAll();
        toast('Welcome, ' + session.user);
        if (!r.link.linked) linkModal();
      });
    }).catch(function (e) {
      btn.disabled = false;
      err.textContent = ERRORS[e.message] || ERRORS.server;
    });
  }

  function linkModal() {
    modal = 'link';
    openModal('<div data-linkbody>' + linkCard().replace('class="sb-card"', 'class=""') + '</div>');
  }
  function refreshLinkModal() {
    if (modal !== 'link') return;
    if (ME && ME.link.linked) { closeModal(); toast('Linked to ' + ME.link.ign + '. You’re ready to bet.'); return; }
    var b = $('[data-linkbody]'); if (b) b.innerHTML = linkCard().replace('class="sb-card"', 'class=""');
  }

  function menu() {
    modal = 'menu';
    var l = ME && ME.link || {};
    openModal('<h2>' + esc(session.user) + '</h2><p>' + (l.linked ? 'Linked to <b style="color:var(--text)">' + esc(l.ign) + '</b> in Minecraft.' : 'Not linked yet.') + '</p>' +
      '<div class="sb-form">' + (l.linked ? '' : '<button type="button" class="btn btn-green btn-block" data-act="link">Link your account</button>') +
      '<button type="button" class="btn btn-block" data-go="bets">My bets</button><button type="button" class="btn btn-block" data-act="signout">Log out</button></div>');
  }

  function signOut() {
    session = null; ME = null; save(SESSION, undefined); closeModal(); renderAll();
  }

  function renderAll() { renderAccount(); renderView(); renderSlip(); }

  function loadBoard() {
    return api({ action: 'board' }).then(function (r) {
      if (r.ok) { B = r; if (slip.legs.length) renderSlip(); renderView(); }
      else if (!B) { $('[data-view]').innerHTML = '<div class="sb-empty"><strong>Can’t reach the sportsbook</strong>Try again in a minute.</div>'; }
    });
  }
  function loadMe() {
    if (!session) return Promise.resolve();
    return authed({ action: 'me' }).then(function (r) {
      if (r.ok) { ME = r; renderAccount(); if (tab === 'bets' || tab === 'standings') renderView(); renderSlip(); refreshLinkModal(); }
      else if (r.error === 'wrong_login') signOut();
    });
  }

  function setTab(t, sub) {
    if (t === 'props') t = sub ? 'game' : 'lines';
    tab = ['lines', 'game', 'bets', 'standings', 'rules'].indexOf(t) >= 0 ? t : 'lines';
    if (tab === 'game') { if (sub !== gameId) propGroup = 'All'; gameId = sub; if (!gameId) tab = 'lines'; }
    renderView();
    window.scrollTo(0, 0);
  }
  function fromHash() {
    var h = (location.hash || '#lines').slice(1).split('/');
    setTab(h[0], h[1] ? decodeURIComponent(h[1]) : null);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a');
    if (!t) { if (e.target.matches('[data-modal]')) closeModal(); return; }
    if (t.hasAttribute('data-sel')) { toggle(t.getAttribute('data-sel')); return; }
    if (t.hasAttribute('data-tab')) { e.preventDefault(); history.pushState(null, '', '#' + t.getAttribute('data-tab')); setTab(t.getAttribute('data-tab')); return; }
    if (t.hasAttribute('data-league')) { league = t.getAttribute('data-league'); savePrefs(); renderView(); return; }
    if (t.hasAttribute('data-pgroup')) { propGroup = t.getAttribute('data-pgroup'); renderView(); return; }
    if (t.hasAttribute('data-cashout')) { cashOut(t.getAttribute('data-cashout'), +t.getAttribute('data-value')); return; }
    if (cashConfirm) { cashConfirm = null; if (tab === 'bets') renderView(); }
    if (t.hasAttribute('data-btab')) { betsTab = t.getAttribute('data-btab'); renderView(); return; }
    if (t.hasAttribute('data-remove')) { toggle(t.getAttribute('data-remove')); if (!findSel(t.getAttribute('data-remove'))) { slip.legs = slip.legs.filter(function (l) { return l.id !== t.getAttribute('data-remove'); }); delete closed[t.getAttribute('data-remove')]; saveSlip(); renderSlip(); } return; }
    if (t.hasAttribute('data-mode')) { slip.mode = t.getAttribute('data-mode'); saveSlip(); renderSlip(); return; }
    if (t.hasAttribute('data-quick')) {
      var q = t.getAttribute('data-quick');
      slip.parlay = q === 'max' ? String(ME && ME.balance ? Math.floor(ME.balance * 100) / 100 : '') : String(Math.round((stakeOf(slip.parlay) + +q) * 100) / 100);
      saveSlip(); var inp = $('[data-pstake]'); if (inp) inp.value = slip.parlay; updateTotals(); return;
    }
    if (t.hasAttribute('data-go')) { closeModal(); history.replaceState(null, '', '#' + t.getAttribute('data-go')); setTab(t.getAttribute('data-go')); return; }
    if (t.hasAttribute('data-close')) { closeModal(); return; }
    if (t.hasAttribute('data-slip-bar')) { slipOpen = true; renderSlip(); return; }
    var act = t.getAttribute('data-act');
    if (act === 'signin') authModal('signin');
    else if (act === 'signup') authModal('signup');
    else if (act === 'signout') signOut();
    else if (act === 'menu') menu();
    else if (act === 'link') linkModal();
    else if (act === 'clear') { slip = { legs: [], mode: 'straight', stakes: {}, parlay: '' }; changes = {}; closed = {}; saveSlip(); renderSlip(); paintButtons(); }
    else if (act === 'closeslip') { slipOpen = false; renderSlip(); }
    else if (act === 'place') place();
    else if (act === 'code') {
      t.disabled = true;
      authed({ action: 'code' }).then(function (r) {
        if (r.ok) { ME = r; refreshLinkModal(); if (tab === 'bets') renderView(); } else toast(ERRORS[r.error] || ERRORS.server);
        t.disabled = false;
      });
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.hasAttribute('data-stake')) { slip.stakes[t.getAttribute('data-stake')] = t.value.replace(/[^0-9.]/g, ''); saveSlip(); updateTotals(); }
    if (t.hasAttribute('data-pstake')) { slip.parlay = t.value.replace(/[^0-9.]/g, ''); saveSlip(); updateTotals(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-auth]');
    if (f) { e.preventDefault(); submitAuth(f); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('[data-modal]').hidden) closeModal(); else if (slipOpen) { slipOpen = false; renderSlip(); } } });
  window.addEventListener('hashchange', fromHash);

  fromHash();
  renderAll();
  loadBoard();
  loadMe();
  setInterval(loadBoard, 30000);
  setInterval(function () {
    if (!session) return;
    if (modal === 'link' || (ME && ME.code && !ME.link.linked) || Date.now() % 20000 < 4000) loadMe();
  }, 4000);
})();
