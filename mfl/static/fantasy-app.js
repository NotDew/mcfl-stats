(function () {
  'use strict';
  var FX = window.FX || {};
  var P = window.FX_POOL || null;
  var E = window.FantasyEngine;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var SESSION = 'mssnFantasySession3';
  var CACHE = 'mssnFantasyShared:';
  var LOCAL_DB = 'mssnFantasyLocalDb';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(key, val) {
    try { if (val === undefined) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function fmt(v) { return (Math.round((v || 0) * 10) / 10).toFixed(1); }
  function ord(n) { return n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'); }
  function clock(ms) { ms = Math.max(0, Math.ceil(ms / 1000)); var m = Math.floor(ms / 60), s = ms % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  function until(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    if (s < 3600) return clock(s * 1000);
    var h = Math.floor(s / 3600), d = Math.floor(h / 24);
    return d ? d + 'd ' + (h % 24) + 'h' : h + 'h ' + Math.floor(s % 3600 / 60) + 'm';
  }

  var toastTimer;
  function toast(msg) {
    var t = $('.fx-toast'); if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }
  function openDialog(d) { if (d.showModal) d.showModal(); else d.setAttribute('open', ''); }
  $$('.fx-dialog').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
    d.addEventListener('close', function () { if (dirty) { dirty = false; route(); } });
  });

  function modal(title, html, okLabel, onOk, danger) {
    var d = $('#fx-modal'); if (!d) return;
    $('#fx-md-title').textContent = title;
    $('.fx-md-body', d).innerHTML = html;
    var ok = $('[data-md-ok]', d);
    ok.textContent = ok.dataset.label = okLabel || 'OK';
    ok.disabled = false;
    ok.hidden = !onOk;
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    ok.onclick = function () { if (onOk && onOk($('.fx-md-body', d)) === false) return; d.close(); };
    openDialog(d);
    return $('.fx-md-body', d);
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-bd]');
    if (!b) return;
    var data;
    try { data = JSON.parse(b.getAttribute('data-bd')); } catch (err) { return; }
    var bd = $('#fx-breakdown'); if (!bd) return;
    $('#fx-bd-title').textContent = data.title;
    var html = '', group = null;
    (data.parts || []).forEach(function (p) {
      if (p[0] !== group) { group = p[0]; html += '<div class="fx-bd-group">' + esc(group) + '</div>'; }
      html += '<div class="fx-bd-row"><span>' + esc(p[1]) + ' <span class="faint">' + esc(p[2]) + ' &times; ' + esc((p[3] > 0 ? '+' : '') + p[3]) +
        '</span></span><strong class="' + (String(p[4]).charAt(0) === '-' ? 'neg' : '') + '">' + esc(p[4]) + '</strong></div>';
    });
    if (!(data.parts || []).length) html = '<p class="faint">Played, but nothing that scores.</p>';
    html += '<div class="fx-bd-total"><span>Total</span><strong>' + esc(data.total) + '</strong></div>';
    $('.fx-bd-body', bd).innerHTML = html;
    openDialog(bd);
  });

  document.addEventListener('click', function (e) {
    $$('details.fx-switch[open]').forEach(function (d) { if (!d.contains(e.target) || e.target.closest('a')) d.removeAttribute('open'); });
  });

  var skew = 0;
  function now() { return Date.now() + skew; }
  var C = P && E ? E.context(P, now) : null;
  var byKey = C ? C.byKey : {}, CW = C ? C.CW : 1, LAST = C ? C.LAST : 1, RULES = C ? C.RULES : {}, REG = C ? C.REG : 5;
  var SLOTS = C ? C.SLOTS : [], STARTS = C ? C.STARTS : [], ROSTER_SIZE = C ? C.ROSTER_SIZE : 0;
  function pts(k, w) { return E.pts(C, k, w); }
  function played(k, w) { return E.played(C, k, w); }
  function game(k, w) { return E.game(C, k, w); }
  function weekState(w) { return E.weekState(C, w); }
  function locked(k, w) { return E.locked(C, k, w); }
  function fits(pos, slot) { return E.fits(C, pos, slot); }
  function bdJson(k, w) {
    var p = byKey[k], x = p && p.w[String(w)];
    if (!x) return '';
    return JSON.stringify({ title: p.n + ' · Week ' + w, total: fmt(x[0]), parts: x[1] });
  }

  var localServer = null;
  function api(body) {
    if (FX.cloud) {
      return fetch(FX.cloud, { method: 'POST', body: JSON.stringify(body) })
        .catch(function () { throw new Error('unreachable'); })
        .then(function (r) { return r.text(); })
        .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('not_json'); } });
    }
    if (!localServer) localServer = E.server(localStore());
    return new Promise(function (resolve) { setTimeout(function () { resolve(JSON.parse(JSON.stringify(localServer(body)))); }, 0); });
  }
  function localStore() {
    var db = function () { return load(LOCAL_DB) || { accounts: {}, leagues: {}, order: [] }; };
    var strip = function (L) { return JSON.parse(JSON.stringify(L)); };
    var put = function (fn) { var d = db(); fn(d); store(LOCAL_DB, d); };
    return {
      now: function () { return Date.now(); }, sleep: function () {},
      lock: function (fn) { return fn(); },
      account: function (key) { return db().accounts[key] || null; },
      saveAccount: function (a) { put(function (d) { d.accounts[a.key] = a; }); },
      deleteAccount: function (key) { put(function (d) { delete d.accounts[key]; }); },
      accountCount: function () { return Object.keys(db().accounts).length; },
      league: function (id) { var L = db().leagues[id]; return L ? JSON.parse(JSON.stringify(L)) : null; },
      saveLeague: function (L) { put(function (d) { if (!d.leagues[L.id]) d.order.push(L.id); d.leagues[L.id] = strip(L); }); },
      deleteLeague: function (id) { put(function (d) { delete d.leagues[id]; d.order = d.order.filter(function (x) { return x !== id; }); }); },
      leagues: function () { var d = db(); return d.order.slice().reverse().map(function (id) { return E.summary(d.leagues[id]); }); },
      newLeagueId: function () { return 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); },
      poolUrl: function () { return 'this-browser'; },
      pool: function () { return P; }
    };
  }

  var ACCOUNT_RE = /^[A-Za-z0-9_.]{3,20}$/;
  var LOGIN_ERRORS = {
    taken: 'That username is taken. Pick another, or sign in.', no_account: 'No account with that username.',
    wrong_login: "That username and password don't match.", full: 'The league server is full right now. Ask Owen.',
    team_taken: 'Another team in the league already has that name.', bad_team: 'Give your team a name (2 to 24 characters).',
    bad_account: 'Usernames are 3 to 20 letters, numbers, _ or .', no_pool: "The league server couldn't load the player list. Try again in a minute.",
    unreachable: 'Couldn\u2019t reach the league server, or it crashed. Check Apps Script > Executions for the error, and that the web app\u2019s \u201cWho has access\u201d is Anyone.',
    not_json: 'The league server sent back an error page instead of an answer. In Apps Script, check Code.gs and fantasy_engine are both pasted and saved, then deploy a new version.',
    league_full: 'That league has no open seats.', no_league: 'That league doesn\u2019t exist any more.', server: 'The league server had a problem. Try again.',
    wrong_password: 'That isn\u2019t the league\u2019s password.', bad_league_name: 'Give the league a name (3 to 30 characters).',
    bad_password: 'Private leagues need a password of at least 4 characters.', bad_size: 'Leagues have 2 to 12 teams.',
    too_many_leagues: 'You\u2019re in as many leagues as one account can be (12). Leave one first.', bad_request: 'That didn\u2019t work. Reload the page and try again.'
  };
  var ACT_ERRORS = {
    taken: 'Someone else just got that player.', not_your_turn: 'It isn’t your pick yet.', no_room: 'There’s no room on your roster for that position.',
    on_waivers: 'That player is on waivers: put in a claim instead.', not_on_waivers: 'That player is a free agent now: add them instead.',
    roster_full: 'Your roster is full: pick someone to drop first.', their_roster_full: 'Their roster is full, so the trade can’t go through.',
    players_moved: 'Some of those players have moved since the offer was made.', cant_move: 'That move isn’t allowed (a player may be locked).',
    lineup_changed: 'Your lineup changed. Try again.', not_yours: 'That player isn’t on your team any more.', no_trade: 'That offer isn’t open any more.',
    bad_trade: 'Pick players on at least one side.', not_active: 'That opens once the draft is done.', not_drafting: 'The draft is over.',
    started: 'The draft has already started.', not_commish: 'Only the commissioner can do that.', bad_time: 'Pick a time in the future.',
    bad_size: 'The league can’t be smaller than the number of managers already in it.', team_taken: 'Another team already has that name.',
    bad_team: 'Team names need 2 to 24 characters.', no_player: 'That player isn’t in the pool any more.', no_team: 'You aren’t in this league any more.',
    no_pool: 'The league server couldn’t load the player list. Try again in a minute.', server: 'The league server had a problem. Try again.',
    bad_request: 'That didn’t work. Reload the page and try again.'
  };

  function b64(bytes) { return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))); }
  function randomB64(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return b64(a); }
  function hashPassword(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: FX.iterations || 310000 }, key, 256);
    }).then(b64);
  }
  function poolUrl() { return new URL(FX.froot + 'data/engine.json', location.href).href; }
  function need(r) {
    if (r.ok) return r;
    throw new Error(r.error === 'server' && r.detail ? LOGIN_ERRORS.server + ' (' + r.detail + ')' : r.error || 'server');
  }

  function createAccount(user, password) {
    var salt = randomB64(16);
    return hashPassword(password, salt).then(function (hash) {
      return api({ action: 'register', user: user, salt: salt, hash: hash }).then(need).then(function (r) {
        return { session: { user: user, hash: hash, league: null }, r: r };
      });
    });
  }
  function signIn(user, password) {
    return api({ action: 'salt', user: user }).then(need).then(function (r) {
      return hashPassword(password, r.salt);
    }).then(function (hash) {
      return api({ action: 'load', user: user, hash: hash }).then(need).then(function (r) {
        return { session: { user: user, hash: hash, league: r.mine.length ? r.mine[0].id : null }, r: r };
      });
    });
  }

  var session = load(SESSION);
  function cacheKey() { return CACHE + session.user.toLowerCase() + ':' + session.league; }
  var cached = session && session.league ? load(cacheKey()) : null;
  var L = cached && cached.league && cached.league.v === E.VERSION ? cached.league : null;
  var ME = L ? cached.me : null;
  var LEAGUES = [], MINE = (session && load(CACHE + session.user.toLowerCase() + ':mine')) || [];
  var busy = 0, dirty = false;

  function setState(r) {
    if (typeof r.now === 'number') skew = r.now - Date.now();
    if (r.leagues) LEAGUES = r.leagues;
    if (r.mine) { MINE = r.mine; if (session) store(CACHE + session.user.toLowerCase() + ':mine', MINE); }
    if (!r.league) return;
    L = r.league; ME = r.me;
    if (session) {
      if (session.league !== L.id) { session.league = L.id; store(SESSION, session); }
      store(cacheKey(), { league: L, me: ME });
      if (!MINE.some(function (x) { return x.id === L.id; })) MINE.unshift(E.summary(L));
    }
  }
  function openLeague(id, hash) {
    session.league = id; store(SESSION, session);
    var c = id ? load(cacheKey()) : null;
    L = c && c.league && c.league.v === E.VERSION ? c.league : null; ME = L ? c.me : null;
    moving = null;
    location.hash = hash || (id ? '#home' : '#leagues');
    route();
    if (id) api({ action: 'load', user: session.user, hash: session.hash, league: id }).then(function (r) {
      if (!r.ok) { if (r.error === 'no_league') { toast(LOGIN_ERRORS.no_league); openLeague(null); } return; }
      setState(r); route();
    }).catch(function () {});
    schedulePoll();
  }
  function signOut() {
    store(SESSION, undefined);
    session = null; L = null; ME = null; MINE = []; LEAGUES = [];
    location.hash = '#home';
    route();
  }

  function act(op, args, after) {
    if (!L || !session) return;
    var before = JSON.stringify(L);
    try { E.apply(L, C, ME, op, args); } catch (e) { toast(ACT_ERRORS[e.code] || ACT_ERRORS.server); L = JSON.parse(before); return; }
    route();
    busy++; setSaving(true);
    api({ action: 'act', user: session.user, hash: session.hash, league: L.id, op: op, args: args }).then(function (r) {
      busy--; setSaving(false);
      if (!r.ok) {
        if (r.error === 'wrong_login') { toast('You were signed out. Sign in again.'); signOut(); return; }
        toast(ACT_ERRORS[r.error] || ACT_ERRORS.server);
        L = JSON.parse(before); route(); refresh();
        return;
      }
      setState(r); toast(r.msg); route();
      if (after) after();
    }).catch(function () {
      busy--; setSaving(false);
      toast('Couldn’t reach the league server. Your move wasn’t saved.');
      L = JSON.parse(before); route();
    });
  }
  function setSaving(on) { $$('[data-save-state]').forEach(function (el) { el.textContent = on ? 'Saving…' : FX.cloud ? 'Saved' : 'Saved on this device'; el.className = 'fx-save fx-save-' + (on ? 'saving' : 'saved'); }); }

  var pollTimer = null;
  function pollDelay() {
    if (!L || (mount('leagues') && !mount('leagues').hidden)) return FX.cloud ? 10000 : 3000;
    if (L.status === 'drafting') return FX.cloud ? 2500 : 1000;
    return FX.cloud ? 5000 : 2000;
  }
  function schedulePoll(ms) { clearTimeout(pollTimer); pollTimer = setTimeout(poll, ms == null ? pollDelay() : ms); }
  function poll() {
    if (!session || !C) return;
    if (document.hidden || busy) return schedulePoll();
    var onList = mount('leagues') && !mount('leagues').hidden;
    if (!L || onList) {
      api({ action: 'leagues', user: session.user, hash: session.hash }).then(function (r) {
        if (!r.ok) { if (r.error === 'wrong_login') signOut(); return; }
        setState(r);
        if (!mount('leagues').hidden) rerender();
      }).catch(function () {}).then(function () { schedulePoll(); });
      return;
    }
    var id = L.id;
    api({ action: 'poll', user: session.user, hash: session.hash, league: id, since: L.rev }).then(function (r) {
      if (!L || L.id !== id) return;
      if (!r.ok) {
        if (r.error === 'wrong_login') { toast(LOGIN_ERRORS[r.error]); signOut(); }
        else if (r.error === 'no_league') { toast('That league was deleted.'); MINE = MINE.filter(function (x) { return x.id !== id; }); openLeague(null); }
        return;
      }
      if (typeof r.now === 'number') skew = r.now - Date.now();
      if (r.same || busy) return;
      var was = L;
      setState(r);
      news(was, L);
      rerender();
    }).catch(function () {}).then(function () { schedulePoll(); });
  }
  function refresh() { schedulePoll(0); }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });

  function rerender() {
    var a = document.activeElement;
    var typing = a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA') && a.closest('#fx-app') && !a.closest('[data-view=draft]');
    if ($('#fx-modal[open]') || moving || typing) { dirty = true; header(); return; }
    var y = window.scrollY;
    route();
    window.scrollTo(0, y);
  }
  document.addEventListener('focusout', function () { setTimeout(function () { if (dirty && !$('#fx-modal[open]') && !moving) { dirty = false; var y = window.scrollY; route(); window.scrollTo(0, y); } }, 50); });

  function news(was, is) {
    if (!was || was.id !== is.id) return;
    if (was.status !== is.status) {
      if (is.status === 'drafting') toast('The draft has started!');
      if (is.status === 'active') toast('The draft is done. Good luck this season!');
      return;
    }
    if (is.status === 'drafting' && E.onClock(is) === ME && E.onClock(was) !== ME) { toast('You’re on the clock!'); return; }
    var old = {}; was.trades.forEach(function (t) { old[t.id] = t.status; });
    var msg = '';
    is.trades.forEach(function (t) {
      if (t.to === ME && t.status === 'pending' && !old[t.id]) msg = team(t.from).name + ' sent you a trade offer.';
      if (t.from === ME && old[t.id] === 'pending' && t.status !== 'pending') msg = team(t.to).name + (t.status === 'Accepted' ? ' accepted your trade!' : t.status === 'Rejected' ? ' declined your trade.' : ': your trade couldn’t go through.');
    });
    if (!msg) {
      var fresh = is.tx.filter(function (x) { return x.time > (was.tx.length ? was.tx[was.tx.length - 1].time : 0) && x.team !== ME; });
      var last = fresh[fresh.length - 1];
      if (last && (last.t === 'join' || last.t === 'add' || last.t === 'trade' || last.t === 'waiver')) msg = txPlain(last);
    }
    if (msg) toast(msg);
  }

  function team(tid) { return E.team(L, tid); }
  function ownerOf(k) { return E.ownerOf(L, k); }
  function lineup(tid, w) { return E.lineup(L, tid, w); }
  function standings() { return E.standings(L, C); }
  function playoffs() { return E.playoffs(L, C); }
  function champion() { return E.champion(L, C); }
  function allMatchups() { return E.allMatchups(L, C); }
  function regDone() { return E.regDone(C); }
  function myMatchup(w, tid) { return E.teamMatchup(L, C, w, tid || ME); }
  function isCommish() { var t = team(ME); return !!(t && L.commish && t.owner === L.commish); }
  function commishTeam() { return L.teams.filter(function (t) { return t.owner && t.owner === L.commish; })[0] || null; }
  function mySummary() { return MINE.filter(function (x) { return L && x.id === L.id; })[0]; }
  function incoming() { return L.trades.filter(function (t) { return t.to === ME && t.status === 'pending'; }); }

  function posLabel(pos) { return pos === 'DEF' ? 'D/ST' : pos; }
  function slotLabel(s) { return s === 'BENCH' ? 'BN' : posLabel(s); }
  function asset(path) { return !path ? '' : /^https?:/.test(path) ? path : FX.root + path; }
  function mark(name, logo, color) {
    return '<span class="team-mark" style="--c:' + esc(color) + '" title="' + esc(name) + '">' +
      (logo ? '<img src="' + esc(asset(logo)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '</span>';
  }
  function tlogo(t, size) { return '<span class="fx-logo ' + (size || '') + '" style="--c:' + esc(t.color) + '" aria-hidden="true">' + esc(t.abbrev) + '</span>'; }
  function youTag(t) { return t.id === ME ? ' <span class="fx-you">You</span>' : !t.owner ? ' <span class="fx-bot">Bot</span>' : ''; }
  function teamLink(tid, size, sub) {
    var t = team(tid); if (!t) return '';
    var rec = sub ? standings().filter(function (r) { return r.id === tid; })[0] : null;
    return '<a class="fx-team-link" href="#team/' + t.id + '">' + tlogo(t, size) + '<span class="fx-tl-text"><span class="fx-tl-name">' + esc(t.name) + youTag(t) + '</span>' +
      (rec ? '<span class="fx-tl-sub">' + rec.record + ' &middot; ' + esc(t.manager) + '</span>' : '') + '</span></a>';
  }
  function gameHtml(g) {
    if (!g || g.state === 'none') return '<span class="fx-game faint">No game</span>';
    var when = '';
    if (g.status) when = ' <span class="fx-gs">' + esc(g.status) + '</span>';
    else if (g.kick) {
      var d = new Date(g.kick);
      var day = d.toLocaleDateString([], { weekday: 'short' });
      when = ' <span class="fx-gs">' + (g.tbd ? day + ' &middot; TBD' : day + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) + '</span>';
    }
    return '<span class="fx-game fx-game-' + g.state + '">' + esc(g.at) + ' ' + mark(g.opp, g.ol, g.oc) + '<span class="fx-opp">' + esc(g.opp) + '</span>' + when + '</span>';
  }
  function ptsBtn(k, w) {
    var bd = bdJson(k, w);
    var g = game(k, w);
    var val = played(k, w) ? fmt(pts(k, w)) : (g.state === 'final' || w < CW ? '0.0' : '–');
    return bd ? '<button type="button" class="fx-pts" data-bd="' + esc(bd) + '" title="How these points were scored">' + val + '</button>'
      : '<span class="fx-pts none">' + val + '</span>';
  }
  function playerHtml(k, w, opts) {
    opts = opts || {};
    var p = byKey[k];
    if (!p) return '<div class="fx-player"><span class="avatar fx-empty-av"></span><div class="fx-p-body"><div class="fx-p-name faint">Unknown</div></div></div>';
    var owner = opts.owner ? ownerOf(k) : null;
    return '<div class="fx-player">' + p.av.split('{ROOT}').join(FX.root) + '<div class="fx-p-body">' +
      '<div class="fx-p-name"><a class="plink" href="' + FX.froot + p.u + '">' + esc(p.n) + '</a>' +
      (L && E.onWaivers(L, k) ? ' <span class="fx-wv">WV</span>' : '') + '</div>' +
      '<div class="fx-p-meta"><span class="fx-pos fx-pos-' + p.pos.toLowerCase() + '">' + posLabel(p.pos) + '</span><span class="team-tag">' + mark(p.t, p.l, p.c) + esc(p.t) + '</span>' +
      (opts.owner ? '<span class="fx-own">' + (owner ? esc(team(owner).abbrev) : 'FA') + '</span>' : '') + '</div>' +
      (w ? '<div class="fx-p-game">' + gameHtml(game(k, w)) + '</div>' : '') + '</div></div>';
  }
  function stateBadge(st, label) {
    return '<span class="fx-state fx-state-' + st + '">' + (st === 'live' ? '<span class="live-dot"></span>' : '') + esc(label) + '</span>';
  }
  var STATE_LABEL = { final: 'Final', live: 'In progress', upcoming: 'Upcoming' };
  function mLabel(m) {
    var l = STATE_LABEL[m.state];
    return m.kind === 'semifinal' ? 'Semifinal · ' + l : m.kind === 'final' ? 'Championship · ' + l : l;
  }
  function scoreCard(m) {
    var mine = m.a === ME || m.b === ME;
    var rows = [[m.a, m.sa], [m.b, m.sb]].map(function (x) {
      var t = team(x[0]);
      var rec = standings().filter(function (r) { return r.id === x[0]; })[0];
      return '<div class="fx-sc-row ' + (m.winner === t.id ? 'won' : m.winner && m.winner !== 'tie' ? 'lost' : '') + '">' + tlogo(t, 'sm') +
        '<span class="fx-sc-name">' + esc(t.name) + ' <span class="faint">' + rec.record + '</span></span><span class="fx-sc-score">' +
        (m.state === 'upcoming' ? '&ndash;' : fmt(x[1])) + '</span></div>';
    }).join('');
    return '<a class="card fx-score-card ' + (mine ? 'fx-mine' : '') + '" href="#matchup/' + m.week + '/' + m.a + '">' +
      '<div class="fx-sc-top">' + stateBadge(m.state, mLabel(m)) + '<span class="faint">Week ' + m.week + '</span></div>' + rows + '</a>';
  }
  function empty(title, text) {
    return '<div class="card coming-soon fx-empty-card"><h3>' + esc(title) + '</h3><p>' + text + '</p></div>';
  }
  function head(t, eyebrow, meta, side) {
    return '<div class="card fx-head" style="--c:' + esc(t.color) + '">' + tlogo(t, 'xl') + '<div class="fx-head-body"><span class="eyebrow">' + eyebrow +
      '</span><h1 class="fx-head-title">' + esc(t.name) + '</h1><div class="fx-head-meta">' + meta + '</div></div>' + (side ? '<div class="fx-head-side">' + side + '</div>' : '') + '</div>';
  }
  function pname(k) { return byKey[k] ? '<a class="plink" href="' + FX.froot + byKey[k].u + '">' + esc(byKey[k].n) + '</a>' : 'a player'; }
  function txText(x) {
    var t = team(x.team), who = t ? '<strong>' + esc(t.name) + '</strong>' : '';
    if (x.t === 'join') return who + (x.was ? ' joined the league, taking over ' + esc(x.was) : ' joined the league');
    if (x.t === 'leave') return who + ' is now run by a bot';
    if (x.t === 'draft-start') return 'The draft started';
    if (x.t === 'draft') return 'The draft finished: every team has ' + ROSTER_SIZE + ' players';
    if (x.t === 'add') return who + ' added ' + pname(x.k) + (x.drop ? ', dropped ' + pname(x.drop) : '');
    if (x.t === 'drop') return who + ' dropped ' + pname(x.k);
    if (x.t === 'waiver') return who + ' claimed ' + pname(x.k) + ' off waivers' + (x.drop ? ', dropped ' + pname(x.drop) : '');
    if (x.t === 'waiver-lost') return who + ' lost a waiver claim on ' + pname(x.k);
    if (x.t === 'trade-no') { var f = team(x.to); return who + ' declined a trade from <strong>' + esc(f ? f.name : '') + '</strong>'; }
    if (x.t === 'trade') {
      var o = team(x.to);
      return who + ' traded ' + (x.give.map(pname).join(', ') || 'nothing') + ' to <strong>' + esc(o ? o.name : '') + '</strong> for ' + (x.get.map(pname).join(', ') || 'nothing');
    }
    return who + ' ' + esc(x.t);
  }
  function txPlain(x) { var d = document.createElement('div'); d.innerHTML = txText(x); return d.textContent + '.'; }
  var TX_LABEL = { join: 'League', leave: 'League', 'draft-start': 'Draft', draft: 'Draft', add: 'Add', drop: 'Drop', waiver: 'Waiver', 'waiver-lost': 'Waiver', trade: 'Trade', 'trade-no': 'Trade' };
  function txItem(x) {
    var type = TX_LABEL[x.t] || x.t;
    return '<div class="fx-act" data-tx-type="' + type + '" data-tx-team="' + esc(x.team || '') + ' ' + esc(x.to || '') + '" data-tx-week="' + (x.week || '') + '">' +
      '<span class="fx-act-type fx-act-' + (x.t === 'waiver-lost' ? 'drop' : x.t === 'trade-no' ? 'trade' : x.t) + '">' + type + '</span><div class="fx-act-body"><div class="fx-act-text">' + txText(x) +
      '</div><div class="fx-act-meta">Week ' + x.week + ' &middot; ' + new Date(x.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</div></div></div>';
  }
  function recentTx(n, tid) {
    return L.tx.filter(function (x) { return !tid || x.team === tid || x.to === tid; }).slice(-n).reverse();
  }

  var VIEWS = {};
  var mount = function (name) { return $('[data-view="' + name + '"]'); };

  VIEWS.home = function () {
    var me = team(ME), rows = standings(), my = rows.filter(function (r) { return r.id === ME; })[0];
    var m = myMatchup(CW);
    var html = head(me, 'Week ' + CW + ' &middot; ' + esc(L.name),
      '<span><strong>' + my.record + '</strong> record</span><span><strong>' + ord(my.rank) + '</strong> place</span><span><strong>' + fmt(my.pf) + '</strong> points for</span><span class="faint">Manager: ' + esc(me.manager) + '</span>');
    var offers = incoming();
    if (offers.length) {
      html += '<a class="card fx-alert" href="#trades"><strong>' + offers.length + ' trade offer' + (offers.length > 1 ? 's' : '') + ' waiting</strong><span>From ' +
        offers.map(function (t) { return esc(team(t.from).name); }).join(', ') + '. Review &rarr;</span></a>';
    }
    if (m) {
      var mineA = m.a === ME, opp = team(mineA ? m.b : m.a);
      var ms = mineA ? m.sa : m.sb, os = mineA ? m.sb : m.sa;
      var bar = ms + os ? Math.round(ms / (ms + os) * 100) : 50;
      var oppRec = rows.filter(function (r) { return r.id === opp.id; })[0];
      html += '<div class="card fx-matchup-hero"><div class="fx-mh-top">' + stateBadge(m.state, mLabel(m)) + '<span class="faint">Week ' + m.week + ' matchup</span></div>' +
        '<div class="fx-mh-row"><div class="fx-mh-side">' + tlogo(me, 'lg') + '<div class="fx-mh-name">' + esc(me.name) + '</div><div class="fx-mh-rec">' + my.record + '</div></div>' +
        '<div class="fx-mh-scores"><span class="fx-mh-score ' + (ms > os ? 'lead' : '') + '">' + fmt(ms) + '</span><span class="fx-mh-vs">vs</span><span class="fx-mh-score ' + (os > ms ? 'lead' : '') + '">' + fmt(os) + '</span></div>' +
        '<div class="fx-mh-side">' + tlogo(opp, 'lg') + '<div class="fx-mh-name">' + esc(opp.name) + '</div><div class="fx-mh-rec">' + oppRec.record + ' &middot; ' + esc(opp.manager) + '</div></div></div>' +
        '<div class="fx-bar" style="--a:' + me.color + ';--b:' + opp.color + '"><span style="width:' + bar + '%"></span></div>' +
        '<div class="fx-mh-actions"><a class="btn btn-primary" href="#matchup/' + m.week + '/' + ME + '">View matchup</a><a class="btn btn-ghost" href="#team">Edit lineup</a><a class="btn btn-ghost" href="#players/available">Add players</a></div></div>';
    } else {
      html += empty('No matchup this week', my.rank <= RULES.playoff_teams || !regDone() ? 'Your team has no game in Week ' + CW + '.' : 'Your season is over. Check the League page for the playoffs.');
    }
    var ln = lineup(ME, CW);
    var active = ln.filter(function (r) { return game(r.k, CW).state === 'scheduled'; }).length;
    var emptyStarts = STARTS.length - ln.filter(function (r) { return r.s !== 'BENCH'; }).length;
    var tile = function (k, v, warn) { return '<div class="card fx-tile"><span class="k">' + k + '</span><span class="v">' + v + '</span>' + (warn ? '<span class="fx-warn">' + warn + '</span>' : '') + '</div>'; };
    html += '<div class="fx-summary">' + tile('Starters', ln.filter(function (r) { return r.s !== 'BENCH'; }).length, emptyStarts ? emptyStarts + ' empty' : '') +
      tile('Bench', ln.filter(function (r) { return r.s === 'BENCH'; }).length) + tile('Still to play', active) +
      tile('Roster', L.roster[ME].length + '/' + ROSTER_SIZE) + tile('Waiver order', ord(my.waiver)) + '</div>';
    var week = allMatchups().filter(function (x) { return x.week === CW; });
    html += '<section><div class="section-head fx-sh"><div><span class="eyebrow">Week ' + CW + '</span><h2 class="section-title">Scoreboard</h2></div><a class="section-link" href="#league">All weeks &rarr;</a></div>' +
      '<div class="fx-score-grid">' + (week.map(scoreCard).join('') || '<p class="empty-note">No games this week.</p>') + '</div></section>';
    var side = '<div class="card fx-block"><div class="table-head"><h2>Standings</h2><a class="section-link" href="#standings">Full &rarr;</a></div>' + miniStandings(rows) + '</div>' +
      '<div class="card fx-block"><div class="table-head"><h2>Recent activity</h2><a class="section-link" href="#transactions">All &rarr;</a></div>' +
      (recentTx(7).map(txItem).join('') || '<p class="empty-note fx-pad">Nothing yet.</p>') + '</div>';
    mount('home').innerHTML = '<div class="fx-layout"><div class="fx-main">' + html + '</div><aside class="fx-side">' + side + '</aside></div>';
  };

  function miniStandings(rows) {
    return '<table class="data-table fx-mini-table"><thead><tr><th class="l">#</th><th class="l">Team</th><th>W-L</th><th>PF</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr class="' + (r.id === ME ? 'fx-mine ' : '') + (r.rank === RULES.playoff_teams ? 'fx-cut' : '') + '"><td class="l rank-num">' + r.rank + '</td><td class="l">' + teamLink(r.id, 'sm') +
          '</td><td class="strong">' + r.record + '</td><td>' + fmt(r.pf) + '</td></tr>';
      }).join('') + '</tbody></table><p class="fx-foot-note">Top ' + RULES.playoff_teams + ' make the playoffs.</p>';
  }

  var STATUS_LABEL = { open: 'Draft lobby', drafting: 'Drafting now', active: 'In season' };
  var COLOR_CHOICES = ['#e0404f', '#e8833a', '#e8b54d', '#45c486', '#4fd1e8', '#3f6fe6', '#9b6cf0', '#e85aa8'];
  var LOCK_ICON = '<svg class="fx-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="Private"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  var leagueFilter = 'all';
  function swatches(name) {
    var pick = Math.floor(Math.random() * COLOR_CHOICES.length);
    return '<span class="fx-swatches">' + COLOR_CHOICES.map(function (c, i) {
      return '<label class="fx-swatch" style="--c:' + c + '"><input type="radio" name="' + name + '" value="' + c + '"' + (i === pick ? ' checked' : '') + ' aria-label="Color ' + (i + 1) + '"><span></span></label>';
    }).join('') + '</span>';
  }
  VIEWS.leagues = function () {
    var mineIds = MINE.map(function (x) { return x.id; });
    var cards = MINE.map(function (x) {
      return '<button type="button" class="card fx-league-card ' + (L && L.id === x.id ? 'fx-mine' : '') + '" data-act="open-league" data-id="' + esc(x.id) + '"><span class="fx-lc-top">' +
        '<strong>' + esc(x.name) + '</strong>' + (x['private'] ? LOCK_ICON : '') + '</span><span class="faint">' + STATUS_LABEL[x.status] + ' &middot; ' + x.managers + ' of ' + x.size + ' managers</span>' +
        '<span class="fx-lc-go">Open &rarr;</span></button>';
    }).join('');
    var list = LEAGUES.filter(function (x) { return leagueFilter === 'all' || (leagueFilter === 'public' ? !x['private'] : leagueFilter === 'private' ? x['private'] : x.open); });
    var rows = list.map(function (x) {
      var inIt = mineIds.indexOf(x.id) >= 0;
      var btn = inIt ? '<button type="button" class="fx-add ghost" data-act="open-league" data-id="' + esc(x.id) + '">Open</button>'
        : x.open ? '<button type="button" class="fx-add" data-act="join-league" data-id="' + esc(x.id) + '">Join</button>'
        : '<span class="fx-add ghost is-static">Full</span>';
      return '<tr><td class="l"><div class="fx-lg-name"><strong>' + esc(x.name) + '</strong>' + (x['private'] ? LOCK_ICON : '') + '</div><div class="faint fx-lg-sub">' + (x['private'] ? 'Private' : 'Public') + ' &middot; ' + STATUS_LABEL[x.status] + '</div></td>' +
        '<td class="l">' + esc(x.creator) + '</td><td>' + x.managers + '/' + x.size + '</td><td class="l fx-lg-status"><span class="fx-po">' + STATUS_LABEL[x.status] + '</span></td><td>' + btn + '</td></tr>';
    }).join('');
    var html = '<div class="section-head"><div><span class="eyebrow">Season ' + P.season + ' &middot; Signed in as ' + esc(session.user) + '</span><h1 class="section-title">Leagues</h1></div>' +
      '<button type="button" class="btn btn-primary" data-act="create-league">+ Create a league</button></div>';
    html += MINE.length ? '<div class="fx-lc-head">Your leagues</div><div class="fx-league-cards">' + cards + '</div>'
      : '<div class="card fx-block fx-pad fx-welcome"><strong>You’re not in a league yet.</strong><p class="muted">Join one below, or create your own and invite friends. Private leagues need a password to join.</p></div>';
    html += '<div class="card table-card fx-block fx-lg-card"><div class="table-head"><h2>All leagues</h2><div class="pill-tabs fx-lg-tabs">' + [['all', 'All'], ['open', 'Open seats'], ['public', 'Public'], ['private', 'Private']].map(function (x) {
      return '<button type="button" class="pill-tab ' + (leagueFilter === x[0] ? 'active' : '') + '" data-lfilter="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div></div>' +
      (rows ? '<div class="table-scroll"><table class="data-table fx-lg-table"><thead><tr><th class="l">League</th><th class="l">Created by</th><th>Managers</th><th class="l fx-lg-status">Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<p class="empty-note fx-pad">' + (LEAGUES.length ? 'No leagues match.' : 'No leagues yet. Create the first one!') + '</p>') + '</div>' +
      '<p class="fx-foot-note">Anyone can join a league with an open seat. Join after the draft and you take over a bot’s team.</p>';
    mount('leagues').innerHTML = html;
  };
  function formError(body, m) { var err = $('[data-form-error]', body); err.textContent = m; err.hidden = false; return false; }
  function busyButton(label) { var ok = $('[data-md-ok]'); ok.disabled = !!label; ok.textContent = label || ok.dataset.label; }
  function leagueCall(action, msg) {
    var id = L.id;
    api({ action: action, user: session.user, hash: session.hash, league: id }).then(function (r) {
      if (!r.ok) { toast(ACT_ERRORS[r.error] || LOGIN_ERRORS[r.error] || ACT_ERRORS.server); return; }
      store(CACHE + session.user.toLowerCase() + ':' + id, undefined);
      L = null; ME = null; setState(r); openLeague(null); toast(msg);
    }).catch(function () { toast('Couldn’t reach the league server. Try again.'); });
  }
  function createFlow() {
    modal('Create a league', '<div class="fx-acct-form fx-flat" data-create-form>' +
      '<label class="fx-field"><span>League name</span><input name="name" maxlength="30" required placeholder="e.g. Redstone Rivals"></label>' +
      '<div class="fx-field"><span>Who can join</span><span class="fx-privacy"><label><input type="radio" name="privacy" value="public" checked><span>Public</span></label><label><input type="radio" name="privacy" value="private"><span>Private (password)</span></label></span></div>' +
      '<label class="fx-field" data-pass-field hidden><span>League password</span><input name="pass" type="password" autocomplete="new-password" placeholder="Share it with the people you invite"></label>' +
      '<div class="fx-2col"><label class="fx-field"><span>Teams</span><select class="fx-select" name="size">' + [2, 4, 6, 8, 10, 12].map(function (n) { return '<option' + (n === (FX.size || 6) ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
      '<label class="fx-field"><span>Pick timer</span><select class="fx-select" name="timer">' + E.TIMERS.map(function (t) { return '<option value="' + t + '"' + (t === 60 ? ' selected' : '') + '>' + t + ' seconds</option>'; }).join('') + '</select></label></div>' +
      '<label class="fx-field"><span>Your team name</span><input name="team" maxlength="24" required placeholder="e.g. Diamond Dynasty"></label>' +
      '<div class="fx-field"><span>Team color</span>' + swatches('color') + '</div><p class="fx-form-error" data-form-error hidden></p></div>',
      'Create league', function (body) {
        var f = $('[data-create-form]', body), v = function (n) { var el = f.querySelector('[name=' + n + ']:checked') || f.querySelector('[name=' + n + ']'); return el ? el.value : ''; };
        var priv = v('privacy') === 'private', name = v('name').trim(), teamName = v('team').trim(), pw = v('pass');
        if (name.length < 3) return formError(body, LOGIN_ERRORS.bad_league_name);
        if (priv && pw.length < 4) return formError(body, LOGIN_ERRORS.bad_password);
        if (teamName.length < 2) return formError(body, LOGIN_ERRORS.bad_team);
        busyButton('Creating…');
        var salt = priv ? randomB64(16) : null;
        (priv ? hashPassword(pw, salt) : Promise.resolve(null)).then(function (pass) {
          return api({ action: 'create', user: session.user, hash: session.hash, name: name, 'private': priv, salt: salt, pass: pass, size: +v('size'), timer: +v('timer'),
            team: teamName, color: (f.querySelector('input[name=color]:checked') || {}).value || COLOR_CHOICES[0], pool: poolUrl() });
        }).then(function (r) {
          busyButton();
          if (!r.ok) return formError(body, LOGIN_ERRORS[r.error] || ACT_ERRORS[r.error] || LOGIN_ERRORS.server + (r.detail ? ' (' + r.detail + ')' : ''));
          $('#fx-modal').close();
          setState(r); openLeague(L.id, '#draft');
          toast('League created. Invite your friends!');
        }).catch(function (x) { busyButton(); formError(body, LOGIN_ERRORS[x.message] || LOGIN_ERRORS.server); });
        return false;
      });
  }
  function joinFlow(id) {
    var x = LEAGUES.filter(function (l) { return l.id === id; })[0]; if (!x) return;
    modal('Join ' + x.name, '<div class="fx-acct-form fx-flat" data-join-form><p class="muted">' + (x['private'] ? 'A private league. ' : '') + 'Created by <strong>' + esc(x.creator) + '</strong> &middot; ' + x.managers + ' of ' + x.size + ' managers &middot; ' + STATUS_LABEL[x.status] +
      (x.status !== 'open' ? '. You’ll take over a bot’s team.' : '.') + '</p>' +
      (x['private'] ? '<label class="fx-field"><span>League password</span><input name="pass" type="password" autocomplete="off" required></label>' : '') +
      '<label class="fx-field"><span>Your team name</span><input name="team" maxlength="24" required></label>' +
      '<div class="fx-field"><span>Team color</span>' + swatches('color') + '</div><p class="fx-form-error" data-form-error hidden></p></div>',
      'Join league', function (body) {
        var f = $('[data-join-form]', body), teamName = f.querySelector('[name=team]').value.trim();
        if (teamName.length < 2) return formError(body, LOGIN_ERRORS.bad_team);
        busyButton('Joining…');
        (x['private'] ? hashPassword(f.querySelector('[name=pass]').value, x.salt) : Promise.resolve(null)).then(function (pass) {
          return api({ action: 'join', user: session.user, hash: session.hash, league: id, pass: pass, team: teamName, color: (f.querySelector('input[name=color]:checked') || {}).value || COLOR_CHOICES[3] });
        }).then(function (r) {
          busyButton();
          if (!r.ok) return formError(body, LOGIN_ERRORS[r.error] || ACT_ERRORS[r.error] || LOGIN_ERRORS.server + (r.detail ? ' (' + r.detail + ')' : ''));
          $('#fx-modal').close();
          setState(r); openLeague(L.id);
          var j = L.tx.filter(function (t) { return t.t === 'join' && t.team === ME; }).pop();
          toast(j && j.was ? 'You’re in! You took over ' + j.was + '.' : 'You’re in!');
        }).catch(function (x) { busyButton(); formError(body, LOGIN_ERRORS[x.message] || LOGIN_ERRORS.server); });
        return false;
      });
  }

  var draftTab = 'players', dstate = { pos: '', q: '' };
  VIEWS.draft = function (args) {
    if (args[0]) draftTab = args[0];
    if (L.status === 'active') { VIEWS.league(['draft']); $$('.fx-view').forEach(function (v) { v.hidden = v.dataset.view !== 'league'; }); return; }
    mount('draft').innerHTML = L.status === 'open' ? lobbyHtml() : roomHtml();
    drawDraftPlayers();
    tickClocks();
  };
  function lobbyHtml() {
    var cm = commishTeam(), d = L.draft, men = E.humans(L);
    var when = d.startAt ? 'Starts in <strong data-countdown="' + d.startAt + '">' + until(d.startAt - now()) + '</strong> &middot; ' +
      new Date(d.startAt).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : 'Starts when ' + (cm ? '<strong>' + esc(cm.manager) + '</strong>' : 'the commissioner') + ' starts it';
    var html = '<div class="card fx-head fx-draft-head"><span class="fx-brand-mark lg">' + ICON_DRAFT + '</span><div class="fx-head-body"><span class="eyebrow">' + esc(L.name) + ' &middot; Draft lobby</span>' +
      '<h1 class="fx-head-title">The draft</h1><div class="fx-head-meta"><span>' + when + '</span><span><strong>' + men.length + '</strong> of ' + L.size + ' managers</span><span><strong>' + d.timer + 's</strong> per pick</span><span><strong>' + ROSTER_SIZE + '</strong> rounds, snake order</span></div></div></div>';
    var seats = L.teams.map(function (t) {
      return '<div class="fx-seat">' + tlogo(t, 'md') + '<div class="fx-seat-text"><strong>' + esc(t.name) + youTag(t) + '</strong><span>' + esc(t.manager) + (t.owner === L.commish ? ' &middot; Commissioner' : '') + '</span></div></div>';
    }).join('');
    for (var i = L.teams.length; i < L.size; i++) seats += '<div class="fx-seat fx-seat-open"><span class="fx-logo md fx-tbd">?</span><div class="fx-seat-text"><strong>Open seat</strong><span>A bot takes it if nobody joins</span></div></div>';
    var main = '<div class="card fx-block"><div class="table-head"><h2>Managers</h2><span class="faint">' + men.length + ' joined</span></div><div class="fx-seats">' + seats + '</div></div>' +
      '<div class="card fx-block fx-pad fx-invite"><div><strong>Invite friends</strong><p class="muted">Send them this page’s link. Once they have an account, they can join <strong>' + esc(L.name) + '</strong> from the Leagues tab' + (mySummary() && mySummary()['private'] ? ', with your league password' : '') + '.</p></div><button type="button" class="btn btn-ghost" data-act="copy-link">Copy link</button></div>' +
      draftBoardCard('Get ready: queue players', 'Star the players you want. When it’s your pick and time runs out, you get the first one still on the board.');
    var side = '';
    if (isCommish()) {
      var local = d.startAt ? new Date(d.startAt - new Date(d.startAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
      side += '<form class="card fx-block fx-pad fx-acct-form" data-draft-form><div class="table-head fx-flush"><h2>Commissioner</h2></div>' +
        '<label class="fx-field"><span>Pick timer</span><select class="fx-select" name="timer">' + E.TIMERS.map(function (s) { return '<option value="' + s + '"' + (s === d.timer ? ' selected' : '') + '>' + s + ' seconds</option>'; }).join('') + '</select></label>' +
        '<label class="fx-field"><span>Teams</span><select class="fx-select" name="size">' + [2, 4, 6, 8, 10, 12].filter(function (n) { return n >= Math.max(2, men.length) || n === L.size; }).map(function (n) { return '<option' + (n === L.size ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<label class="fx-field"><span>Start automatically at</span><input type="datetime-local" name="startAt" value="' + local + '"></label>' +
        '<button class="btn btn-ghost" type="submit">Save settings</button>' +
        '<div class="fx-draft-btns"><button class="btn btn-primary" type="button" data-act="draft-start">Start the draft now</button>' +
        '<button class="btn btn-ghost" type="button" data-act="draft-autodraft" title="For testing: every pick is made by the computer, right away">Auto-draft</button></div>' +
        '<p class="fx-foot-note">Bots fill the empty seats when the draft starts. Anyone who joins later takes over a bot team.</p></form>';
    }
    side += queueCard();
    return '<div class="fx-layout"><div class="fx-main">' + html + main + '</div><aside class="fx-side">' + side + '</aside></div>';
  }
  function roomHtml() {
    var d = L.draft, n = d.order.length, pickNo = d.picks.length + 1, round = Math.ceil(pickNo / n);
    var tid = E.onClock(L), t = team(tid), mine = tid === ME, me = team(ME);
    var next = nextPickOf(ME);
    var html = '<div class="card fx-clock ' + (mine ? 'fx-clock-mine' : '') + '" style="--c:' + esc(t.color) + '"><div class="fx-clock-l">' + tlogo(t, 'lg') + '<div><span class="eyebrow">' + (mine ? 'You’re on the clock!' : 'On the clock') + '</span>' +
      '<div class="fx-clock-team">' + esc(t.name) + youTag(t) + '</div><div class="faint">' + esc(t.manager) + ' &middot; Round ' + round + ' of ' + ROSTER_SIZE + ', pick ' + pickNo + ' of ' + (n * ROSTER_SIZE) + '</div></div></div>' +
      '<div class="fx-clock-r"><div class="fx-clock-time" data-countdown="' + d.deadline + '">' + clock(d.deadline - now()) + '</div><div class="faint">' +
      (mine ? 'Pick a player below' : next ? 'Your next pick: ' + (next - d.picks.length - 1 === 0 ? 'next!' : 'in ' + (next - d.picks.length - 1) + ' pick' + (next - d.picks.length - 1 > 1 ? 's' : '')) : '') + '</div></div></div>';
    if (me.missed || me.auto) {
      html += '<div class="card fx-alert fx-alert-soft"><strong>' + (me.missed ? 'Your pick timed out, so auto-pick is on.' : 'Auto-pick is on.') + '</strong><span>Your picks are made for you from your queue, then the best player left. <button type="button" class="fx-linkbtn" data-act="draft-auto" data-on="0">Turn it off</button></span></div>';
    }
    var upcoming = [];
    for (var i = d.picks.length; i < Math.min(d.picks.length + 10, n * ROSTER_SIZE); i++) {
      var r = Math.floor(i / n), idx = i % n, who = r % 2 ? d.order[n - 1 - idx] : d.order[idx];
      upcoming.push('<span class="fx-order-pick ' + (who === ME ? 'mine' : '') + (i === d.picks.length ? ' now' : '') + '">' + tlogo(team(who), 'sm') + '<span>' + (i + 1) + '</span></span>');
    }
    html += '<div class="fx-order" aria-label="Pick order">' + upcoming.join('') + '</div>';
    html += '<div class="stats-toolbar fx-sub-tabs"><div class="pill-tabs">' + [['players', 'Players'], ['board', 'Draft board']].map(function (x) {
      return '<a class="pill-tab ' + (draftTab === x[0] ? 'active' : '') + '" href="#draft/' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div></div>';
    var main = draftTab === 'board' ? boardHtml() : draftBoardCard('Available players', mine ? 'Tap Draft to make your pick.' : 'Star players to queue them for your next pick.');
    var side = rosterCard() + queueCard() +
      '<div class="card fx-block"><div class="table-head"><h2>Latest picks</h2></div>' + (d.picks.slice(-8).reverse().map(function (p) {
        var pt = team(p.team);
        return '<div class="fx-pick-row">' + '<span class="fx-pick-no">' + p.pick + '</span>' + tlogo(pt, 'sm') + '<div class="fx-pick-text">' + (p.k ? pname(p.k) + ' <span class="faint">' + byKey[p.k].pos + '</span>' : '<span class="faint">No pick</span>') +
          '<span class="faint">' + esc(pt.name) + (p.auto && pt.owner ? ' &middot; auto' : '') + '</span></div></div>';
      }).join('') || '<p class="empty-note fx-pad">No picks yet.</p>') + '</div>' +
      '<div class="card fx-block fx-pad fx-draft-btns"><button type="button" class="btn btn-ghost fx-full" data-act="draft-auto" data-on="' + (me.auto ? 0 : 1) + '">' + (me.auto ? 'Turn auto-pick off' : 'Auto-pick for me') + '</button>' +
      (isCommish() ? '<button type="button" class="btn btn-ghost fx-full" data-act="draft-autodraft" title="For testing: every pick is made by the computer, right away">Auto-draft the rest</button>' : '') + '</div>';
    return html + '<div class="fx-layout"><div class="fx-main">' + main + '</div><aside class="fx-side">' + side + '</aside></div>';
  }
  function nextPickOf(tid) {
    var d = L.draft, n = d.order.length;
    for (var i = d.picks.length; i < n * ROSTER_SIZE; i++) {
      var r = Math.floor(i / n), idx = i % n;
      if ((r % 2 ? d.order[n - 1 - idx] : d.order[idx]) === tid) return i + 1;
    }
    return null;
  }
  function draftBoardCard(title, note) {
    return '<div class="card table-card fx-block"><div class="table-head"><h2>' + title + '</h2><span class="faint">' + note + '</span></div>' +
      '<div class="fx-toolbar fx-pad fx-draft-tools"><label class="search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search players..." data-d-search value="' + esc(dstate.q) + '"></label>' +
      '<div class="chip-row fx-d-chips">' + ['', 'QB', 'WR', 'DEF'].map(function (p) { return '<button type="button" class="chip all ' + (dstate.pos === p ? 'active' : '') + '" data-dpos="' + p + '">' + (p ? posLabel(p) : 'All') + '</button>'; }).join('') + '</div></div>' +
      '<div class="table-scroll"><table class="data-table fx-table fx-dtable"><thead><tr><th class="l">Rk</th><th class="l">Player</th><th>FPTS</th><th>Avg</th><th>GP</th><th></th></tr></thead><tbody data-d-body></tbody></table></div></div>';
  }
  function drawDraftPlayers() {
    var body = $('[data-d-body]'); if (!body) return;
    var taken = E.drafted(L), me = team(ME), q = me.queue || [];
    var mine = L.status === 'drafting' && E.onClock(L) === ME;
    var list = C.ranked.filter(function (p) {
      return !taken[p.k] && (!dstate.pos || p.pos === dstate.pos) && (!dstate.q || p.n.toLowerCase().indexOf(dstate.q) >= 0);
    });
    body.innerHTML = list.slice(0, 60).map(function (p) {
      var room = !!E.openSlot(C, L.roster[ME], p.pos), star = q.indexOf(p.k) >= 0;
      return '<tr><td class="l rank-num">' + p.rk + '</td><td class="l">' + playerHtml(p.k) + '</td><td class="sorted">' + fmt(p.tot) + '</td><td>' + fmt(p.avg) + '</td><td>' + p.gp + '</td><td class="fx-d-acts">' +
        '<button type="button" class="fx-star ' + (star ? 'on' : '') + '" data-act="queue" data-k="' + p.k + '" aria-pressed="' + star + '" title="' + (star ? 'Remove from queue' : 'Add to queue') + '">' + (star ? '&#9733;' : '&#9734;') + '</button>' +
        (L.status === 'drafting' ? '<button type="button" class="fx-add" data-act="draft-pick" data-k="' + p.k + '"' + (mine && room ? '' : ' disabled') + ' title="' + (!room ? 'No room for a ' + p.pos : mine ? 'Draft ' + esc(p.n) : 'Wait for your pick') + '">Draft</button>' : '') + '</td></tr>';
    }).join('') + (list.length > 60 ? '<tr><td colspan="6" class="faint fx-more-note">Showing the top 60 of ' + list.length + '. Search or filter to find anyone else.</td></tr>' : '') || '<tr><td colspan="6" class="empty-note">No players left that match.</td></tr>';
  }
  function rosterCard() {
    var ros = L.roster[ME], used = {};
    return '<div class="card fx-block"><div class="table-head"><h2>Your team</h2><span class="faint">' + ros.length + '/' + ROSTER_SIZE + '</span></div>' + SLOTS.map(function (s) {
      var list = ros.filter(function (r) { return r.s === s; }), i = used[s] || 0; used[s] = i + 1;
      var r = list[i];
      return '<div class="fx-mini-slot"><span class="fx-slot fx-slot-' + s.toLowerCase() + '">' + slotLabel(s) + '</span>' + (r ? '<span>' + pname(r.k) + ' <span class="faint">' + posLabel(byKey[r.k].pos) + '</span></span>' : '<span class="faint">Empty</span>') + '</div>';
    }).join('') + '</div>';
  }
  function queueCard() {
    var taken = E.drafted(L), q = (team(ME).queue || []).filter(function (k) { return byKey[k] && !taken[k]; });
    return '<div class="card fx-block"><div class="table-head"><h2>Your queue</h2><span class="faint">' + q.length + '</span></div>' +
      (q.map(function (k, i) {
        return '<div class="fx-mini-slot"><span class="fx-pick-no">' + (i + 1) + '</span><span>' + pname(k) + ' <span class="faint">' + byKey[k].pos + '</span></span>' +
          '<span class="fx-q-acts">' + (i ? '<button type="button" class="fx-linkbtn" data-act="queue-up" data-k="' + k + '" aria-label="Move up">&uarr;</button>' : '') +
          '<button type="button" class="fx-linkbtn" data-act="queue" data-k="' + k + '" aria-label="Remove">&times;</button></span></div>';
      }).join('') || '<p class="empty-note fx-pad">Star players to line them up for your picks.</p>') + '</div>';
  }
  function boardHtml() {
    var d = L.draft, n = d.order.length, byPick = {};
    d.picks.forEach(function (p) { byPick[p.pick] = p; });
    var rows = '';
    for (var r = 0; r < ROSTER_SIZE; r++) {
      var cells = '';
      for (var i = 0; i < n; i++) {
        var no = r * n + (r % 2 ? n - i : i + 1), p = byPick[no];
        cells += '<td class="fx-bd-cell ' + (p && p.team === ME ? 'mine' : '') + (no === d.picks.length + 1 ? ' now' : '') + '">' + (p ? (p.k ? '<span class="fx-pos fx-pos-' + byKey[p.k].pos.toLowerCase() + '">' + byKey[p.k].pos + '</span>' + esc(byKey[p.k].n) : '&ndash;') : '<span class="faint">' + no + '</span>') + '</td>';
      }
      rows += '<tr><td class="l rank-num">' + (r + 1) + '</td>' + cells + '</tr>';
    }
    return '<div class="card table-card fx-block"><div class="table-scroll"><table class="data-table fx-board"><thead><tr><th class="l">Rd</th>' + d.order.map(function (tid) {
      var t = team(tid); return '<th>' + tlogo(t, 'sm') + '<span class="fx-board-team">' + esc(t.name) + '</span></th>';
    }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  var ICON_DRAFT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';

  var lastZero = 0;
  function tickClocks() {
    $$('[data-countdown]').forEach(function (el) {
      var left = +el.dataset.countdown - now();
      el.textContent = el.classList.contains('fx-clock-time') ? clock(left) : until(left);
      el.classList.toggle('fx-urgent', left < 10000);
      if (left <= 0 && Date.now() - lastZero > 3000) { lastZero = Date.now(); refresh(); }
    });
  }
  setInterval(tickClocks, 1000);

  var moving = null;
  VIEWS.team = function (args) {
    var tid = args[0] || ME, t = team(tid);
    if (!t) { location.hash = '#team'; return; }
    var mine = tid === ME, w = CW;
    var rows = standings(), r = rows.filter(function (x) { return x.id === tid; })[0];
    var side = mine ? '<button type="button" class="btn btn-ghost" data-act="autoset">Auto-set lineup</button><a class="btn btn-ghost" href="#players/available">Add players</a>'
      : '<a class="btn btn-primary" href="#trades/' + tid + '">Propose trade</a>';
    var html = head(t, (mine ? 'My team' : 'Manager ' + esc(t.manager) + (t.owner ? '' : ' (bot)')) + ' &middot; ' + esc(L.name),
      '<span><strong>' + r.record + '</strong> record</span><span><strong>#' + r.rank + '</strong> of ' + L.teams.length + '</span><span><strong>' + fmt(r.pf) +
      '</strong> PF</span><span><strong>' + fmt(r.pa) + '</strong> PA</span>' + (r.streak ? '<span><strong>' + r.streak + '</strong> streak</span>' : ''), side);
    var sched = allMatchups().filter(function (m) { return m.a === tid || m.b === tid; }).sort(function (a, b) { return a.week - b.week; });
    html += '<div class="fx-history">' + sched.map(function (m) {
      var o = m.winner ? (m.winner === 'tie' ? 'T' : m.winner === tid ? 'W' : 'L') : null;
      return '<a class="fx-hist ' + (o ? 'fx-hist-' + o.toLowerCase() : 'fx-hist-' + m.state) + '" href="#matchup/' + m.week + '/' + tid + '"><span class="fx-hist-w">W' + m.week + '</span><span class="fx-hist-o">' + (o || (m.state === 'live' ? '&bull;' : '&ndash;')) + '</span></a>';
    }).join('') + '</div>';

    var ln = lineup(tid, w);
    var used = {}, starterRows = [];
    STARTS.forEach(function (s) {
      var list = ln.filter(function (x) { return x.s === s; });
      var i = used[s] || 0; used[s] = i + 1;
      starterRows.push({ s: s, r: list[i] || null });
    });
    var benchRows = ln.filter(function (x) { return x.s === 'BENCH'; }).map(function (x) { return { s: 'BENCH', r: x }; });
    var total = ln.reduce(function (sum, x) { return sum + (x.s !== 'BENCH' ? pts(x.k, w) : 0); }, 0);
    var row = function (item) {
      var k = item.r && item.r.k, lock = k && locked(k, w);
      var target = mine && moving && moving.k !== k && E.canSwap(L, C, ME, moving, { k: k, s: item.s });
      var btn = !mine ? '<span class="fx-slot fx-slot-' + item.s.toLowerCase() + '">' + slotLabel(item.s) + '</span>'
        : target ? '<button type="button" class="fx-slot fx-slot-here" data-act="here" data-k="' + (k || '') + '" data-s="' + item.s + '">Here</button>'
        : moving && moving.k === k ? '<button type="button" class="fx-slot fx-slot-moving" data-act="cancel-move">Cancel</button>'
        : k && !lock ? '<button type="button" class="fx-slot fx-slot-' + item.s.toLowerCase() + ' fx-slot-btn" data-act="move" data-k="' + k + '" data-s="' + item.s + '" title="Move">' + slotLabel(item.s) + '</button>'
        : '<span class="fx-slot fx-slot-' + item.s.toLowerCase() + '" title="' + (lock ? 'Locked: this week’s game has started' : '') + '">' + slotLabel(item.s) + (lock ? ' &#128274;' : '') + '</span>';
      if (!k) {
        return '<div class="fx-lrow is-empty ' + (target ? 'fx-target' : '') + '">' + btn + '<div class="fx-player"><span class="avatar fx-empty-av"></span><div class="fx-p-body"><div class="fx-p-name faint">Empty</div><div class="fx-p-meta faint">' +
          (mine ? 'Move a bench player here, or add one' : 'Nobody in this spot') + '</div></div></div><span class="fx-lrow-stat"></span><span class="fx-lrow-stat"></span><span></span></div>';
      }
      return '<div class="fx-lrow ' + (target ? 'fx-target' : '') + (moving && moving.k === k ? ' fx-moving' : '') + '">' + btn + playerHtml(k, w) +
        '<span class="fx-lrow-stat"><span class="k">Avg</span>' + fmt(byKey[k].avg) + '</span><span class="fx-lrow-stat fx-lrow-pts"><span class="k">Pts</span>' + ptsBtn(k, w) + '</span>' +
        (mine ? '<button type="button" class="fx-more" data-act="menu" data-k="' + k + '" aria-label="More for ' + esc(byKey[k].n) + '"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></button>' : '<span></span>') + '</div>';
    };
    var main = '<div class="card fx-block" id="lineup"><div class="table-head"><h2>Starting lineup</h2><span class="faint">Week ' + w + ' &middot; ' + STATE_LABEL[weekState(w)] + '</span></div>' +
      '<div class="fx-lhead"><span>Slot</span><span>Player</span><span>Avg</span><span>Pts</span><span></span></div>' + starterRows.map(row).join('') +
      '<div class="fx-ltotal"><span>Starters total</span><strong>' + fmt(total) + '</strong></div></div>' +
      '<div class="card fx-block" id="roster"><div class="table-head"><h2>Bench</h2><span class="faint">' + L.roster[tid].length + '/' + ROSTER_SIZE + ' on the roster</span></div>' +
      (mine && moving && moving.s !== 'BENCH' ? '<div class="fx-lrow fx-target"><button type="button" class="fx-slot fx-slot-here" data-act="here" data-k="" data-s="BENCH">Here</button><div class="fx-p-body faint">Move ' + esc(byKey[moving.k].n) + ' to the bench</div></div>' : '') +
      (benchRows.map(row).join('') || (mine && moving ? '' : '<p class="empty-note fx-pad">Nobody on the bench.</p>')) + '</div>' +
      (mine ? '<p class="fx-foot-note">Tap a player’s slot to move them, then tap <strong>Here</strong> where they should go. A player locks once their game starts. Only starters score.</p>' : '');
    var aside = '<div class="card fx-block"><div class="table-head"><h2>Schedule</h2></div><table class="data-table fx-mini-table"><thead><tr><th class="l">Wk</th><th class="l">Opponent</th><th>Result</th></tr></thead><tbody>' +
      sched.map(function (m) {
        var oppId = m.a === tid ? m.b : m.a, my = m.a === tid ? m.sa : m.sb, op = m.a === tid ? m.sb : m.sa;
        var o = m.winner ? (m.winner === 'tie' ? 'T' : m.winner === tid ? 'W' : 'L') : null;
        return '<tr><td class="l rank-num">' + m.week + '</td><td class="l">' + teamLink(oppId, 'sm') + (m.kind !== 'regular' ? ' <span class="fx-po-tag">' + (m.kind === 'final' ? 'Final' : 'Semi') + '</span>' : '') + '</td><td>' +
          (o ? '<span class="fx-res fx-res-' + o.toLowerCase() + '">' + o + '</span> ' : m.state === 'live' ? '<span class="fx-res fx-res-live">Live</span> ' : '') +
          (m.state !== 'upcoming' ? '<a class="plink" href="#matchup/' + m.week + '/' + tid + '">' + fmt(my) + '&ndash;' + fmt(op) + '</a>' : '<a class="faint" href="#matchup/' + m.week + '/' + tid + '">Preview</a>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="card fx-block"><div class="table-head"><h2>Activity</h2></div>' + (recentTx(8, tid).map(txItem).join('') || '<p class="empty-note fx-pad">No moves yet.</p>') + '</div>';
    mount('team').innerHTML = html + '<div class="fx-layout"><div class="fx-main">' + main + '</div><aside class="fx-side">' + aside + '</aside></div>';
  };

  VIEWS.matchup = function (args) {
    var w = +(args[0] || CW), tid = args[1] || ME;
    var m = myMatchup(w, tid);
    var weeks = allMatchups().filter(function (x) { return x.a === tid || x.b === tid; }).map(function (x) { return x.week; })
      .filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
    var tabs = '<div class="fx-week-tabs pill-tabs">' + weeks.map(function (x) {
      return '<a class="pill-tab ' + (x === w ? 'active' : '') + '" href="#matchup/' + x + '/' + tid + '">Week ' + x + '</a>';
    }).join('') + '</div>';
    if (!m) { mount('matchup').innerHTML = tabs + empty('No matchup', 'No game for this team in Week ' + w + (w > REG ? ' – playoff games are set once the regular season ends.' : '.')); return; }
    var A = team(m.a), B = team(m.b), rows = standings();
    var rec = function (id) { return rows.filter(function (r) { return r.id === id; })[0].record; };
    var bar = m.sa + m.sb ? Math.round(m.sa / (m.sa + m.sb) * 100) : 50;
    var side = function (t, s, lead, seed) {
      return '<a class="fx-mh-side ' + (m.winner === t.id ? 'won' : '') + '" href="#team/' + t.id + '">' + tlogo(t, 'lg') + '<div class="fx-mh-name">' + esc(t.name) + '</div><div class="fx-mh-rec">' + rec(t.id) + ' &middot; ' + esc(t.manager) +
        (seed ? ' &middot; #' + seed + ' seed' : '') + '</div><div class="fx-mh-score ' + (lead ? 'lead' : '') + '">' + fmt(s) + '</div></a>';
    };
    var html = tabs + '<div class="card fx-matchup-hero fx-matchup-big"><div class="fx-mh-top">' + stateBadge(m.state, mLabel(m)) + '<span class="faint">' + esc(L.name) + ' &middot; Week ' + w + '</span></div>' +
      '<div class="fx-mh-row">' + side(A, m.sa, m.sa > m.sb, m.seeds && m.seeds[0]) + '<div class="fx-mh-vs">vs</div>' + side(B, m.sb, m.sb > m.sa, m.seeds && m.seeds[1]) + '</div>' +
      '<div class="fx-bar" style="--a:' + A.color + ';--b:' + B.color + '"><span style="width:' + bar + '%"></span></div>' +
      (m.state === 'live' ? '<p class="fx-foot-note">Games are still being played. Scores update as each game is logged (the site refreshes about every 30 minutes).</p>' :
        m.state === 'upcoming' ? '<p class="fx-foot-note">No Week ' + w + ' games logged yet. Scores fill in as they are.</p>' : '') + '</div>';
    var la = lineup(m.a, w), lb = lineup(m.b, w);
    var starters = function (ln) {
      var used = {}, out = [];
      STARTS.forEach(function (s) { var list = ln.filter(function (x) { return x.s === s; }); var i = used[s] || 0; used[s] = i + 1; out.push({ s: s, k: list[i] ? list[i].k : null }); });
      return out;
    };
    var sa = starters(la), sb = starters(lb);
    html += '<div class="card fx-block fx-compare"><div class="fx-cmp-head"><span class="fx-cmp-team">' + tlogo(A, 'sm') + esc(A.name) + '</span><span class="fx-cmp-mid">Pts</span><span class="fx-cmp-mid">Slot</span><span class="fx-cmp-mid">Pts</span><span class="fx-cmp-team r">' + esc(B.name) + tlogo(B, 'sm') + '</span></div>' +
      sa.map(function (x, i) {
        var y = sb[i], pa = x.k ? pts(x.k, w) : 0, pb = y.k ? pts(y.k, w) : 0;
        return '<div class="fx-cmp-row"><div class="fx-cmp-p">' + (x.k ? playerHtml(x.k, w) : '<span class="faint">Empty</span>') + '</div><div class="fx-cmp-pts ' + (x.k && y.k && pa > pb ? 'win' : '') + '">' + (x.k ? ptsBtn(x.k, w) : '&ndash;') +
          '</div><div class="fx-cmp-slot"><span class="fx-slot fx-slot-' + x.s.toLowerCase() + '">' + slotLabel(x.s) + '</span></div><div class="fx-cmp-pts ' + (x.k && y.k && pb > pa ? 'win' : '') + '">' + (y.k ? ptsBtn(y.k, w) : '&ndash;') +
          '</div><div class="fx-cmp-p r">' + (y.k ? playerHtml(y.k, w) : '<span class="faint">Empty</span>') + '</div></div>';
      }).join('') +
      '<div class="fx-cmp-row fx-cmp-total"><div class="fx-cmp-p">Total</div><div class="fx-cmp-pts"><strong>' + fmt(m.sa) + '</strong></div><div></div><div class="fx-cmp-pts"><strong>' + fmt(m.sb) + '</strong></div><div class="fx-cmp-p r">Total</div></div></div>';
    html += '<div class="fx-bench-grid">' + [[A, la], [B, lb]].map(function (x) {
      var bench = x[1].filter(function (r) { return r.s === 'BENCH'; });
      var bp = bench.reduce(function (s, r) { return s + pts(r.k, w); }, 0);
      return '<div class="card fx-block"><div class="table-head"><h2>' + esc(x[0].name) + ' bench</h2><span class="faint">' + fmt(bp) + ' pts on the bench</span></div>' +
        (bench.map(function (r) {
          return '<div class="fx-lrow"><span class="fx-slot">BN</span>' + playerHtml(r.k, w) + '<span class="fx-lrow-stat"><span class="k">Avg</span>' + fmt(byKey[r.k].avg) + '</span><span class="fx-lrow-stat fx-lrow-pts"><span class="k">Pts</span>' + ptsBtn(r.k, w) + '</span></div>';
        }).join('') || '<p class="empty-note fx-pad">Nobody on the bench.</p>') + '</div>';
    }).join('') + '</div>';
    mount('matchup').innerHTML = html;
  };

  var pstate = { owner: 'all', pos: '', team: '', q: '', sort: 'tot', dir: -1 };
  VIEWS.players = function (args) {
    if (args[0]) pstate.owner = args[0];
    var teams = Object.keys(P.games).sort();
    var html = '<div class="section-head"><div><span class="eyebrow">Week ' + CW + ' &middot; ' + P.players.length + ' players</span><h1 class="section-title">Players</h1></div></div>' +
      '<div class="fx-toolbar"><div class="pill-tabs" data-owner-tabs>' + [['all', 'All players'], ['available', 'Available'], ['rostered', 'Rostered'], ['mine', 'My players']].map(function (x) {
        return '<button type="button" class="pill-tab ' + (pstate.owner === x[0] ? 'active' : '') + '" data-owner="' + x[0] + '">' + x[1] + '</button>';
      }).join('') + '</div><div class="search-row fx-search-row"><label class="search-box"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input type="search" placeholder="Search players..." data-p-search value="' + esc(pstate.q) + '"></label>' +
      '<div class="chip-row fx-pos-chips">' + ['', 'QB', 'WR', 'DEF'].map(function (p) { return '<button type="button" class="chip all ' + (pstate.pos === p ? 'active' : '') + '" data-pos="' + p + '">' + (p ? posLabel(p) : 'All') + '</button>'; }).join('') + '</div>' +
      '<select class="fx-select" data-p-team aria-label="Team"><option value="">All teams</option>' + teams.map(function (t) { return '<option' + (pstate.team === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select>' +
      '<span class="result-count" data-p-count></span></div></div>' +
      '<div class="card table-card"><div class="table-scroll"><table class="data-table fx-table"><thead><tr>' +
      [['rk', 'Rk', 'l'], [null, 'Player', 'l'], [null, 'Status', 'l'], [null, 'This week', 'l'], ['tot', 'FPTS'], ['avg', 'Avg'], ['gp', 'GP'], ['last', 'Last'], [null, '']].map(function (c) {
        return '<th class="' + (c[2] || '') + (c[0] === pstate.sort ? ' sorted' : '') + '"' + (c[0] ? ' data-sort="' + c[0] + '"' + (c[0] === pstate.sort ? ' data-dir="' + (pstate.dir > 0 ? 'asc' : 'desc') + '"' : '') : '') + '>' + c[1] + '</th>';
      }).join('') + '</tr></thead><tbody data-p-body></tbody></table></div><p class="empty-note fx-pad" data-p-none hidden>No players match.</p></div>' +
      '<p class="fx-foot-note">Free agents join your roster right away. Players marked <span class="fx-wv">WV</span> were just dropped: claims go through when the next week starts, worst record first.</p>';
    mount('players').innerHTML = html;
    drawPlayers();
  };
  function lastPts(p) { var ws = Object.keys(p.w).map(Number).sort(function (a, b) { return a - b; }); return ws.length ? p.w[ws[ws.length - 1]][0] : 0; }
  function drawPlayers() {
    var body = $('[data-p-body]'); if (!body) return;
    var list = P.players.filter(function (p) {
      var own = ownerOf(p.k);
      return (pstate.owner === 'all' || (pstate.owner === 'available' && !own) || (pstate.owner === 'rostered' && own) || (pstate.owner === 'mine' && own === ME)) &&
        (!pstate.pos || p.pos === pstate.pos) && (!pstate.team || p.t === pstate.team) && (!pstate.q || p.n.toLowerCase().indexOf(pstate.q) >= 0);
    });
    var key = { rk: function (p) { return p.rk; }, tot: function (p) { return p.tot; }, avg: function (p) { return p.avg; }, gp: function (p) { return p.gp; }, last: lastPts }[pstate.sort];
    list.sort(function (a, b) { return (key(a) - key(b)) * pstate.dir; });
    var claimed = {}; L.claims.forEach(function (c) { if (c.team === ME) claimed[c.add] = true; });
    body.innerHTML = list.slice(0, 200).map(function (p) {
      var own = ownerOf(p.k), wv = !own && L.waivers[p.k];
      var action = own === ME ? '<button type="button" class="fx-add ghost" data-act="drop" data-k="' + p.k + '">Drop</button>'
        : own ? '<a class="fx-add ghost" href="#trades/' + own + '/' + p.k + '">Trade</a>'
        : claimed[p.k] ? '<span class="fx-add ghost is-static">Claimed</span>'
        : '<button type="button" class="fx-add" data-act="add" data-k="' + p.k + '">' + (wv ? 'Claim' : '+ Add') + '</button>';
      return '<tr><td class="l rank-num">' + p.rk + '</td><td class="l">' + playerHtml(p.k) + '</td><td class="l">' + (own ? teamLink(own, 'sm') : '<span class="fx-fa">' + (wv ? 'Waivers' : 'Free agent') + '</span>') +
        '</td><td class="l">' + gameHtml(game(p.k, CW)) + '</td><td class="' + (pstate.sort === 'tot' ? 'sorted' : '') + '">' + fmt(p.tot) + '</td><td class="' + (pstate.sort === 'avg' ? 'sorted' : '') + '">' + fmt(p.avg) +
        '</td><td>' + p.gp + '</td><td>' + fmt(lastPts(p)) + '</td><td>' + action + '</td></tr>';
    }).join('');
    $('[data-p-count]').textContent = list.length + ' player' + (list.length === 1 ? '' : 's');
    $('[data-p-none]').hidden = list.length > 0;
  }

  function dropChoices(title) {
    return '<label class="fx-rq-line"><span>' + title + '</span><select class="fx-select" data-drop>' +
      (L.roster[ME].length < ROSTER_SIZE ? '<option value="">Nobody (open spot)</option>' : '') +
      L.roster[ME].slice().sort(function (a, b) { return byKey[a.k].avg - byKey[b.k].avg; }).map(function (r) {
        return '<option value="' + r.k + '">' + esc(byKey[r.k].n) + ' (' + byKey[r.k].pos + ', ' + fmt(byKey[r.k].avg) + ' avg)</option>';
      }).join('') + '</select></label>';
  }
  function addFlow(k) {
    var p = byKey[k]; if (!p || ownerOf(k) || L.status !== 'active') return;
    var wv = !!L.waivers[k];
    modal((wv ? 'Claim ' : 'Add ') + p.n,
      '<div class="fx-rq-line"><span>' + (wv ? 'Claim' : 'Add') + '</span>' + playerHtml(k, CW) + '</div>' + dropChoices('Drop') +
      (wv ? '<p class="fx-foot-note">' + esc(p.n) + ' is on waivers. Your claim goes through when Week ' + L.waivers[k] + ' starts, unless a team ahead of you in waiver order claims first.</p>' : ''),
      wv ? 'Submit claim' : 'Add player', function (body) {
        var drop = $('[data-drop]', body).value || null;
        if (!drop && L.roster[ME].length >= ROSTER_SIZE) { toast('Your roster is full: pick someone to drop.'); return false; }
        act(wv ? 'claim' : 'add', { k: k, drop: drop });
      });
  }
  function dropFlow(k) {
    var p = byKey[k];
    modal('Drop ' + p.n + '?', '<div class="fx-rq-line"><span>Drop</span>' + playerHtml(k, CW) + '</div><p class="fx-foot-note">They go on waivers until Week ' + (CW + 1) + ' starts.' +
      (locked(k, CW) ? ' Their points this week still count for you.' : '') + '</p>', 'Drop player', function () { act('drop', { k: k }); }, true);
  }
  function playerMenu(k) {
    var p = byKey[k];
    var body = modal(p.n, playerHtml(k, CW) + '<div class="fx-menu-list">' +
      '<button type="button" class="fx-menu-item" data-mm="move"><span class="fx-menu-text"><strong>Move in lineup</strong><span>' + (locked(k, CW) ? 'Locked: this week’s game has started' : 'Start or bench') + '</span></span></button>' +
      '<button type="button" class="fx-menu-item" data-mm="trade"><span class="fx-menu-text"><strong>Trade</strong><span>Offer to another team</span></span></button>' +
      '<button type="button" class="fx-menu-item" data-mm="drop"><span class="fx-menu-text"><strong>Drop</strong><span>Release to waivers</span></span></button>' +
      '<a class="fx-menu-item" href="' + FX.froot + p.u + '"><span class="fx-menu-text"><strong>Player page</strong><span>Game log and stats</span></span></a></div>');
    body.addEventListener('click', function (e) {
      var b = e.target.closest('[data-mm]'); if (!b) return;
      e.preventDefault();
      $('#fx-modal').close();
      if (b.dataset.mm === 'move') {
        if (locked(k, CW)) { toast('Locked: this player’s game has started.'); return; }
        var r = L.roster[ME].filter(function (x) { return x.k === k; })[0];
        moving = { k: k, s: r.s }; route();
      }
      if (b.dataset.mm === 'drop') dropFlow(k);
      if (b.dataset.mm === 'trade') { tradeState = { other: '', give: {}, get: {} }; tradeState.give[k] = true; location.hash = '#trades'; }
    });
  }

  var tradeState = { other: '', give: {}, get: {} };
  var TRADE_STATUS = { pending: 'Waiting', Accepted: 'Accepted', Rejected: 'Declined', Cancelled: 'Withdrawn', Failed: 'Failed' };
  function tradeCols(tr, mineFrom) {
    var n = function (k) { return byKey[k] ? '<div>' + pname(k) + ' <span class="faint">' + byKey[k].pos + ' &middot; ' + fmt(byKey[k].avg) + ' avg</span></div>' : ''; };
    var give = mineFrom ? tr.give : tr.get, get = mineFrom ? tr.get : tr.give;
    return '<div class="fx-rq-cols"><div class="fx-rq-col"><div class="fx-trade-k">You give</div>' + (give.map(n).join('') || '<div class="faint">Nobody</div>') + '</div>' +
      '<div class="fx-rq-col"><div class="fx-trade-k">You receive</div>' + (get.map(n).join('') || '<div class="faint">Nobody</div>') + '</div></div>';
  }
  VIEWS.trades = function (args) {
    if (args[0]) { if (tradeState.other !== args[0]) tradeState.get = {}; tradeState.other = args[0]; }
    if (args[1]) tradeState.get[args[1]] = true;
    var list = function (tid, which) {
      return L.roster[tid].map(function (r) {
        var p = byKey[r.k];
        return '<label class="fx-trade-p"><input type="checkbox" data-pick="' + which + '" value="' + r.k + '"' + (tradeState[which][r.k] ? ' checked' : '') + '><span class="fx-slot">' + slotLabel(r.s) + '</span>' +
          '<span class="fx-trade-name">' + esc(p.n) + '</span><span class="faint">' + posLabel(p.pos) + ' &middot; ' + fmt(p.avg) + '</span></label>';
      }).join('');
    };
    var html = '<div class="section-head"><div><span class="eyebrow">' + esc(L.name) + '</span><h1 class="section-title">Trade center</h1></div></div>';
    var offers = incoming(), mine = L.trades.filter(function (t) { return t.from === ME && t.status === 'pending'; });
    if (offers.length) {
      html += '<div class="card fx-block"><div class="table-head"><h2>Offers for you</h2><span class="faint">' + offers.length + ' waiting</span></div>' + offers.map(function (tr) {
        var f = team(tr.from);
        return '<div class="fx-offer"><div class="fx-offer-head">' + tlogo(f, 'sm') + '<strong>' + esc(f.name) + '</strong><span class="faint">' + esc(f.manager) + ' &middot; ' + new Date(tr.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '</span></div>' +
          tradeCols(tr, false) + (tr.note ? '<p class="fx-offer-note">&ldquo;' + esc(tr.note) + '&rdquo;</p>' : '') +
          '<div class="fx-offer-acts"><button type="button" class="btn btn-primary" data-act="trade-accept" data-id="' + tr.id + '">Accept</button><button type="button" class="btn btn-ghost" data-act="trade-decline" data-id="' + tr.id + '">Decline</button></div></div>';
      }).join('') + '</div>';
    }
    if (mine.length) {
      html += '<div class="card fx-block"><div class="table-head"><h2>Your offers</h2><span class="faint">Waiting for an answer</span></div>' + mine.map(function (tr) {
        var o = team(tr.to);
        return '<div class="fx-offer"><div class="fx-offer-head">' + tlogo(o, 'sm') + '<strong>To ' + esc(o.name) + '</strong><span class="faint">' + esc(o.manager) + '</span></div>' + tradeCols(tr, true) +
          '<div class="fx-offer-acts"><button type="button" class="btn btn-ghost" data-act="trade-cancel" data-id="' + tr.id + '">Withdraw offer</button></div></div>';
      }).join('') + '</div>';
    }
    html += '<div class="card fx-block fx-trade"><div class="table-head"><h2>Propose a trade</h2><span class="faint">Managers answer from their Trade center; bots answer right away</span></div><div class="fx-trade-cols">' +
      '<div class="fx-trade-col"><div class="fx-trade-k">You give</div><div class="fx-trade-name-big">' + esc(team(ME).name) + '</div><div class="fx-trade-list">' + list(ME, 'give') + '</div></div>' +
      '<div class="fx-trade-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14l-4-4M20 16H6l4 4"/></svg></div>' +
      '<div class="fx-trade-col"><div class="fx-trade-k">You receive</div><select class="fx-select" data-trade-other><option value="">Choose a team…</option>' +
      L.teams.filter(function (t) { return t.id !== ME; }).map(function (t) { return '<option value="' + t.id + '"' + (tradeState.other === t.id ? ' selected' : '') + '>' + esc(t.name) + ' (' + esc(t.manager) + (t.owner ? '' : ', bot') + ')</option>'; }).join('') +
      '</select><div class="fx-trade-list">' + (tradeState.other ? list(tradeState.other, 'get') : '') + '</div></div></div>' +
      '<div class="fx-trade-foot"><span class="faint" data-trade-hint></span><button type="button" class="btn btn-primary" data-act="review-trade">Review trade</button></div></div>';
    var history = L.trades.filter(function (t) { return (t.from === ME || t.to === ME) && t.status !== 'pending'; }).reverse();
    html += '<div class="card table-card fx-block"><div class="table-head"><h2>Trade history</h2></div>' + (history.length ? '<div class="table-scroll"><table class="data-table"><thead><tr><th class="l">Week</th><th class="l">With</th><th class="l">You gave</th><th class="l">You got</th><th class="l">Status</th></tr></thead><tbody>' +
      history.map(function (t) {
        var n = function (k) { return byKey[k] ? esc(byKey[k].n) : '?'; }, fromMe = t.from === ME;
        var gave = fromMe ? t.give : t.get, got = fromMe ? t.get : t.give;
        return '<tr><td class="l">' + t.week + '</td><td class="l">' + teamLink(fromMe ? t.to : t.from, 'sm') + '</td><td class="l">' + (gave.map(n).join(', ') || '&ndash;') + '</td><td class="l">' + (got.map(n).join(', ') || '&ndash;') +
          '</td><td class="l"><span class="fx-po fx-tstat-' + t.status.toLowerCase() + '">' + (TRADE_STATUS[t.status] || t.status) + '</span>' + (t.why ? ' <span class="faint">' + esc(t.why) + '</span>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="empty-note fx-pad">No trades yet.</p>') + '</div>';
    mount('trades').innerHTML = html;
    tradeHint();
  };
  function picked(which) { return Object.keys(tradeState[which]).filter(function (k) { return tradeState[which][k]; }); }
  function tradeHint() {
    var h = $('[data-trade-hint]'); if (!h) return;
    var give = picked('give').filter(function (k) { return ownerOf(k) === ME; }), get = picked('get').filter(function (k) { return ownerOf(k) === tradeState.other; });
    var after = L.roster[ME].length - give.length + get.length;
    h.textContent = !tradeState.other ? 'Choose who to trade with' : !(give.length + get.length) ? 'Tick players on each side'
      : after > ROSTER_SIZE ? 'That leaves you with ' + after + ' players (max ' + ROSTER_SIZE + '): give one more or drop someone first' : 'Ready';
    $('[data-act="review-trade"]').disabled = !tradeState.other || !(give.length + get.length) || after > ROSTER_SIZE;
  }
  function reviewTrade() {
    var other = tradeState.other, o = team(other);
    var give = picked('give').filter(function (k) { return ownerOf(k) === ME; }), get = picked('get').filter(function (k) { return ownerOf(k) === other; });
    modal('Offer to ' + o.name, tradeCols({ give: give, get: get }, true) +
      (o.owner ? '<label class="fx-field fx-trade-note"><span>Message (optional)</span><input maxlength="140" data-trade-note placeholder="Sweeten the deal…"></label><p class="fx-foot-note">' + esc(o.manager) + ' can accept or decline from their Trade center.</p>'
        : '<p class="fx-foot-note">' + esc(o.manager) + ' is a bot and answers right away.</p>'), 'Send offer', function (body) {
      var note = $('[data-trade-note]', body);
      act('trade', { to: other, give: give, get: get, note: note ? note.value : '' }, function () { tradeState = { other: '', give: {}, get: {} }; route(); });
    });
  }

  var leagueTab = 'overview';
  VIEWS.league = function (args) {
    if (args[0]) leagueTab = args[0];
    var champ = champion(), men = E.humans(L).length;
    var html = '<div class="card fx-head fx-league-head"><span class="fx-brand-mark lg"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg></span>' +
      '<div class="fx-head-body"><span class="eyebrow">Season ' + P.season + ' &middot; Week ' + CW + '</span><h1 class="fx-head-title">' + esc(L.name) + '</h1><div class="fx-head-meta"><span><strong>' + L.teams.length + '</strong> teams</span><span><strong>' + men + '</strong> manager' + (men === 1 ? '' : 's') + ', ' + (L.teams.length - men) + ' bot' + (L.teams.length - men === 1 ? '' : 's') + '</span>' +
      (L.joinedWeek ? '<span>Drafted in Week <strong>' + L.joinedWeek + '</strong></span>' : '') + '<span>Playoffs: top <strong>' + RULES.playoff_teams + '</strong> after Week ' + REG + '</span></div></div>' +
      (champ ? '<div class="fx-head-side fx-champ">' + tlogo(team(champ), 'lg') + '<span class="k">Champion</span><strong>' + esc(team(champ).name) + '</strong></div>' : '') + '</div>';
    html += '<div class="stats-toolbar fx-sub-tabs"><div class="pill-tabs">' + [['overview', 'Overview'], ['matchups', 'Matchups'], ['playoffs', 'Playoffs'], ['draft', 'Draft'], ['teams', 'Teams']].map(function (x) {
      return '<a class="pill-tab ' + (leagueTab === x[0] ? 'active' : '') + '" href="#league/' + x[0] + '">' + x[1] + '</a>';
    }).join('') + '</div></div>';
    var all = allMatchups();
    if (leagueTab === 'overview') {
      html += standingsTable() + '<div class="section-head fx-sh"><div><span class="eyebrow">' + STATE_LABEL[weekState(CW)] + '</span><h2 class="section-title">Week ' + CW + '</h2></div></div><div class="fx-score-grid">' +
        (all.filter(function (m) { return m.week === CW; }).map(scoreCard).join('') || '<p class="empty-note">No games this week.</p>') + '</div>';
    } else if (leagueTab === 'matchups') {
      var weeks = all.map(function (m) { return m.week; }).filter(function (x, i, a) { return a.indexOf(x) === i; }).sort(function (a, b) { return a - b; });
      html += weeks.map(function (w) {
        return '<div class="section-head fx-sh"><div><span class="eyebrow">' + STATE_LABEL[weekState(w)] + '</span><h2 class="section-title">Week ' + w + '</h2></div></div><div class="fx-score-grid">' + all.filter(function (m) { return m.week === w; }).map(scoreCard).join('') + '</div>';
      }).join('');
    } else if (leagueTab === 'playoffs') {
      var po = playoffs();
      html += (po.done ? '' : '<p class="fx-foot-note fx-note-top">The regular season is still going: this is the bracket <strong>if the season ended today</strong>.</p>') +
        '<div class="fx-bracket">' + po.rounds.map(function (rd) {
          return '<div class="fx-round"><div class="fx-round-head"><strong>' + rd.name + '</strong><span class="faint">Week ' + rd.week + '</span></div>' + rd.games.map(function (g) {
            return '<div class="card fx-bgame">' + [[g.a, g.sa, g.seeds && g.seeds[0]], [g.b, g.sb, g.seeds && g.seeds[1]]].map(function (x, i) {
              var t = x[0] && team(x[0]);
              return '<div class="fx-brow ' + (t && g.winner === t.id ? 'won' : '') + '"><span class="fx-seed">' + (x[2] || '') + '</span>' +
                (t ? tlogo(t, 'sm') + '<span class="fx-sc-name">' + esc(t.name) + '</span><span class="fx-sc-score">' + (po.done && g.state !== 'upcoming' ? fmt(x[1]) : '') + '</span>'
                  : '<span class="fx-logo sm fx-tbd">?</span><span class="fx-sc-name faint">Winner of semifinal ' + (i + 1) + '</span><span></span>') + '</div>';
            }).join('') + (po.done && g.a && g.b ? '<a class="fx-blink" href="#matchup/' + g.week + '/' + g.a + '">Matchup &rarr;</a>' : '') + '</div>';
          }).join('') + '</div>';
        }).join('') + '<div class="fx-round fx-round-champ"><div class="fx-round-head"><strong>Champion</strong></div><div class="card fx-bgame fx-champ-card">' +
        (champ ? tlogo(team(champ), 'lg') + '<strong>' + esc(team(champ).name) + '</strong>' : '<span class="fx-logo lg fx-tbd">?</span><span class="faint">To be decided</span>') + '</div></div></div>';
    } else if (leagueTab === 'draft') {
      html += '<p class="fx-foot-note fx-note-top">A live snake draft. Picks marked <span class="fx-auto-tag">Auto</span> were made by the clock or a bot.</p><div class="card table-card"><div class="table-scroll"><table class="data-table"><thead><tr><th class="l">Pick</th><th class="l">Rd</th><th class="l">Team</th><th class="l">Player</th><th>FPTS</th></tr></thead><tbody>' +
        L.draft.picks.map(function (d) {
          var pt = team(d.team);
          return '<tr class="' + (d.team === ME ? 'fx-mine' : '') + '"><td class="l rank-num">' + d.pick + '</td><td class="l">' + d.round + '</td><td class="l">' + teamLink(d.team, 'sm') + '</td><td class="l">' +
            (d.k && byKey[d.k] ? playerHtml(d.k) : '<span class="faint">' + (d.k ? 'No longer in the pool' : 'No pick') + '</span>') + (d.auto && pt && pt.owner ? ' <span class="fx-auto-tag">Auto</span>' : '') + '</td><td>' + (d.k && byKey[d.k] ? fmt(byKey[d.k].tot) : '') + '</td></tr>';
        }).join('') + '</tbody></table></div></div>';
    } else {
      html += '<div class="fx-score-grid">' + standings().map(function (r) {
        var t = team(r.id);
        return '<a class="card fx-score-card" href="#team/' + t.id + '"><div class="fx-sc-row">' + tlogo(t, 'md') + '<span class="fx-sc-name">' + esc(t.name) + youTag(t) + '<br><span class="faint">' + esc(t.manager) + ' &middot; ' + r.record + ' &middot; ' + ord(r.rank) + '</span></span></div></a>';
      }).join('') + '</div>';
    }
    mount('league').innerHTML = html;
  };
  function standingsTable() {
    return '<div class="card table-card fx-block"><div class="table-head"><h2>Standings</h2><span class="faint">Top ' + RULES.playoff_teams + ' make the playoffs</span></div><div class="table-scroll"><table class="data-table fx-standings"><thead><tr><th class="l">Rk</th><th class="l">Team</th><th>W</th><th>L</th><th>T</th><th>PF</th><th>PA</th><th>Strk</th><th>Waiver</th><th class="l">Playoffs</th></tr></thead><tbody>' +
      standings().map(function (r) {
        return '<tr class="' + (r.id === ME ? 'fx-mine ' : '') + (r.rank <= 3 && r.gp ? 'r' + r.rank + ' ' : '') + (r.rank === RULES.playoff_teams ? 'fx-cut' : '') + '"><td class="l rank-num">' + r.rank + '</td><td class="l">' + teamLink(r.id, 'md', true) + '</td><td class="strong">' + r.w + '</td><td>' + r.l + '</td><td>' + r.t +
          '</td><td class="strong">' + fmt(r.pf) + '</td><td>' + fmt(r.pa) + '</td><td class="' + (/^W/.test(r.streak) ? 'pos' : /^L/.test(r.streak) ? 'neg' : '') + '">' + (r.streak || '&ndash;') + '</td><td>' + r.waiver + '</td><td class="l">' +
          (r.playoff === 'Clinched' ? '<span class="fx-po fx-po-in">Clinched</span>' : r.playoff === 'Eliminated' ? '<span class="fx-po fx-po-out">Eliminated</span>' : r.playoff ? '<span class="fx-po">' + r.playoff + '</span>' : '<span class="faint">&ndash;</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  VIEWS.standings = function () {
    mount('standings').innerHTML = '<div class="section-head"><div><span class="eyebrow">' + esc(L.name) + ' &middot; Season ' + P.season + '</span><h1 class="section-title">Standings</h1></div></div>' + standingsTable() +
      '<p class="fx-foot-note">Ranked by win percentage, then points for. Only finished weeks count. Waiver order is the reverse of the standings.</p>';
  };
  var txFilter = { type: '', team: '', week: '' };
  VIEWS.transactions = function () {
    var types = ['Add', 'Drop', 'Waiver', 'Trade', 'Draft', 'League'];
    var sel = function (k, v) { return txFilter[k] === String(v) ? ' selected' : ''; };
    var claims = L.claims.filter(function (c) { return c.team === ME; });
    mount('transactions').innerHTML = '<div class="section-head"><div><span class="eyebrow">' + esc(L.name) + '</span><h1 class="section-title">Transactions</h1></div><a class="btn btn-ghost" href="#trades">Trade center &rarr;</a></div>' +
      '<div class="fx-toolbar"><div class="search-row fx-search-row"><select class="fx-select" data-tx-f="type"><option value="">All types</option>' + types.map(function (t) { return '<option' + sel('type', t) + '>' + t + '</option>'; }).join('') + '</select>' +
      '<select class="fx-select" data-tx-f="team"><option value="">All teams</option>' + L.teams.map(function (t) { return '<option value="' + t.id + '"' + sel('team', t.id) + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' +
      '<select class="fx-select" data-tx-f="week"><option value="">All weeks</option>' + Array.from({ length: LAST }, function (_, i) { return '<option value="' + (i + 1) + '"' + sel('week', i + 1) + '>Week ' + (i + 1) + '</option>'; }).join('') + '</select></div></div>' +
      (claims.length ? '<div class="card fx-block"><div class="table-head"><h2>Your pending claims</h2></div>' + claims.map(function (c) {
        return '<div class="fx-act"><span class="fx-act-type fx-act-waiver">Claim</span><div class="fx-act-body"><div class="fx-act-text">Claim ' + pname(c.add) + (c.drop && byKey[c.drop] ? ', drop ' + pname(c.drop) : '') +
          '</div><div class="fx-act-meta">Goes through when Week ' + (CW + 1) + ' starts &middot; <button type="button" class="fx-linkbtn" data-act="cancel-claim" data-k="' + c.add + '">Cancel</button></div></div></div>';
      }).join('') + '</div>' : '') +
      '<div class="card fx-block" data-tx-list>' + (L.tx.slice().reverse().map(txItem).join('') || '<p class="empty-note fx-pad">Nothing yet.</p>') + '<p class="empty-note fx-pad" data-tx-none hidden>Nothing matches.</p></div>';
    filterTx();
  };
  function filterTx() {
    var shown = 0, items = $$('[data-tx-list] .fx-act');
    items.forEach(function (it) {
      var ok = (!txFilter.type || it.dataset.txType === txFilter.type) && (!txFilter.team || it.dataset.txTeam.split(' ').indexOf(txFilter.team) >= 0) && (!txFilter.week || it.dataset.txWeek === txFilter.week);
      it.hidden = !ok; if (ok) shown++;
    });
    var none = $('[data-tx-none]'); if (none) none.hidden = !items.length || shown > 0;
  }

  function accountCard() {
    var el = $('[data-account-card]'); if (!el || !L) return;
    var me = team(ME);
    el.innerHTML = '<div class="table-head"><h2>Your account</h2><span data-save-state></span></div><dl class="fx-dl"><dt>Username</dt><dd>' + esc(session.user) + '</dd><dt>Saved</dt><dd>' +
      (FX.cloud ? 'To the league server (any device)' : 'On this device only') + '</dd>' + (isCommish() ? '<dt>Role</dt><dd>Commissioner</dd>' : '') + '</dl>' +
      '<form class="fx-pad fx-acct-form" data-team-form><label class="fx-field"><span>Team name</span><input name="team" maxlength="24" value="' + esc(me.name) + '"></label>' +
      '<label class="fx-field"><span>Manager name</span><input name="manager" maxlength="20" value="' + esc(me.manager) + '"></label>' +
      '<label class="fx-field"><span>Team color</span><input name="color" type="color" value="' + esc(me.color) + '"></label><button class="btn btn-primary" type="submit">Save changes</button></form>' +
      '<div class="fx-pad fx-acct-actions"><button type="button" class="btn btn-ghost" data-act="signout">Sign out</button>' +
      '<button type="button" class="btn btn-ghost" data-act="leave-league">Leave this league</button>' +
      (isCommish() ? '<button type="button" class="btn btn-danger" data-act="delete-league">Delete this league</button>' : '') +
      '<button type="button" class="btn btn-danger" data-act="delete-account">Delete my account</button></div>';
    setSaving(busy > 0);
  }
  VIEWS.settings = function () {
    accountCard();
    var n = $('[data-league-teams]'), men = E.humans(L).length;
    if (n) n.textContent = L.teams.length ? L.teams.length + ' (' + men + ' manager' + (men === 1 ? '' : 's') + (L.teams.length > men ? ', ' + (L.teams.length - men) + ' bots' : '') + ')' : L.size + ' seats';
  };

  var NAV_OF = { leagues: 'leagues', home: 'home', team: 'team', matchup: 'matchup', players: 'players', league: 'league', standings: 'standings', transactions: 'transactions', trades: 'transactions', settings: 'settings', draft: 'home' };
  function route() {
    if (!mount('home')) { decorateStatic(); return; }
    var parts = (location.hash.replace(/^#/, '') || 'home').split('/');
    var name = parts[0], args = parts.slice(1);
    if (!P || !C) return;
    header();
    if (!session || (!L && name !== 'leagues')) name = session ? 'leagues' : 'signup';
    if (name === 'signup' || name === 'leagues') {
      $$('.fx-view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
      if (name === 'leagues') VIEWS.leagues();
      $$('[data-view-link]').forEach(function (a) { a.classList.toggle('active', a.dataset.viewLink === name); });
      document.title = (name === 'leagues' ? 'Leagues' : 'Fantasy') + ' · MCFL Fantasy';
      return;
    }
    if (name === 'add') { name = 'players'; setTimeout(function () { addFlow(args[0]); }, 0); args = []; }
    if (!VIEWS[name]) name = 'home';
    if (name === 'draft' && L.status === 'active') { name = 'home'; args = []; history.replaceState(null, '', '#home'); }
    if (L.status !== 'active' && name !== 'settings') name = 'draft';
    if (name !== 'team') moving = null;
    $$('.fx-view').forEach(function (v) { v.hidden = v.dataset.view !== name; });
    VIEWS[name](args);
    var nav = name === 'team' && args[0] && args[0] !== ME ? 'league' : NAV_OF[name];
    $$('[data-view-link]').forEach(function (a) { a.classList.toggle('active', a.dataset.viewLink === nav); });
    document.title = (name === 'draft' ? 'Draft' : name.charAt(0).toUpperCase() + name.slice(1)) + ' · ' + L.name;
  }
  function header() {
    $$('[data-signed-in]').forEach(function (el) { el.hidden = !session; });
    $$('[data-in-league]').forEach(function (el) { el.hidden = !L; });
    $$('[data-view-link]').forEach(function (a) { if (a.dataset.viewLink !== 'leagues' && a.dataset.viewLink !== 'stats') a.hidden = !L; });
    $$('[data-view-link="leagues"]').forEach(function (a) { a.hidden = !session; });
    $$('[data-league-menu]').forEach(function (el) {
      el.innerHTML = MINE.map(function (x) {
        return '<a class="fx-menu-item' + (L && L.id === x.id ? ' active' : '') + '" href="' + FX.froot + 'index.html#home" data-act="open-league" data-id="' + esc(x.id) + '"><span class="fx-menu-text"><strong>' + esc(x.name) + (x['private'] ? LOCK_ICON : '') + '</strong><span>' + STATUS_LABEL[x.status] + ' &middot; ' + x.managers + ' of ' + x.size + ' managers</span></span></a>';
      }).join('') + '<a class="fx-menu-item fx-menu-all" href="' + FX.froot + 'index.html#leagues"><span class="fx-menu-text"><strong>All leagues</strong><span>Join one, or create your own</span></span></a>';
    });
    if (!session) return;
    $$('[data-account-name]').forEach(function (el) { el.textContent = 'Signed in as ' + session.user; });
    if (!L) {
      $$('[data-league-name]').forEach(function (el) { el.textContent = 'MCFL Fantasy'; });
      $$('[data-league-sub]').forEach(function (el) { el.textContent = MINE.length ? MINE.length + ' league' + (MINE.length === 1 ? '' : 's') : 'Pick a league'; });
      return;
    }
    var me = team(ME); if (!me) return;
    var men = E.humans(L).length;
    $$('[data-my-team-name]').forEach(function (el) { el.textContent = me.name; });
    $$('[data-league-name]').forEach(function (el) { el.textContent = L.name; });
    $$('[data-league-sub]').forEach(function (el) { el.textContent = L.status === 'active' ? L.teams.length + ' teams · ' + men + ' managers' : L.status === 'drafting' ? 'Drafting now' : men + ' of ' + L.size + ' joined · draft soon'; });
    var n = incoming().length;
    $$('[data-view-link="transactions"]').forEach(function (a) { a.setAttribute('data-badge', n || ''); });
  }
  function decorateStatic() {
    header();
    $$('[data-owner-of]').forEach(function (el) {
      if (!L) { el.innerHTML = '<a class="plink" href="' + FX.froot + 'index.html#leagues">Join a league</a> to add players'; return; }
      var tid = ownerOf(el.dataset.ownerOf), t = tid && team(tid);
      el.innerHTML = t ? 'On <a class="plink" href="' + FX.froot + 'index.html#team/' + t.id + '"><strong>' + esc(t.name) + '</strong></a>' : '<span class="fx-fa">' + (L.waivers[el.dataset.ownerOf] ? 'On waivers' : L.status === 'active' ? 'Free agent' : 'Not drafted yet') + '</span>';
    });
    $$('[data-player-action]').forEach(function (el) {
      if (!L || L.status !== 'active') return;
      var k = el.dataset.playerAction, tid = ownerOf(k);
      el.innerHTML = tid === ME ? '<a class="btn btn-ghost" href="' + FX.froot + 'index.html#team">On your team</a>'
        : tid ? '<a class="btn btn-ghost" href="' + FX.froot + 'index.html#trades/' + tid + '/' + k + '">Propose a trade</a>'
        : '<a class="btn btn-primary" href="' + FX.froot + 'index.html#add/' + k + '">' + (L.waivers[k] ? 'Claim player' : '+ Add player') + '</a>';
    });
  }

  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); if (/^#leagues/.test(location.hash)) refresh(); });

  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-act]');
    if (a) {
      var op = a.dataset.act, k = a.dataset.k;
      if (op === 'move') { moving = { k: k, s: a.dataset.s }; route(); }
      else if (op === 'cancel-move') { moving = null; route(); }
      else if (op === 'here') { var from = moving; moving = null; act('swap', { k: from.k, to: a.dataset.s, 'with': k || null }); }
      else if (op === 'menu') playerMenu(k);
      else if (op === 'autoset') act('autoset', {});
      else if (op === 'add') addFlow(k);
      else if (op === 'drop') dropFlow(k);
      else if (op === 'review-trade') reviewTrade();
      else if (op === 'trade-accept') {
        var tr = L.trades.filter(function (t) { return t.id === a.dataset.id; })[0];
        modal('Accept this trade?', tradeCols(tr, false), 'Accept trade', function () { act('trade-respond', { id: tr.id, accept: true }); });
      }
      else if (op === 'trade-decline') act('trade-respond', { id: a.dataset.id, accept: false });
      else if (op === 'trade-cancel') act('trade-cancel', { id: a.dataset.id });
      else if (op === 'cancel-claim') act('cancel-claim', { k: k });
      else if (op === 'draft-pick') {
        modal('Draft ' + byKey[k].n + '?', playerHtml(k), 'Draft', function () { act('draft-pick', { k: k }); });
      }
      else if (op === 'draft-auto') act('draft-auto', { on: a.dataset.on === '1' });
      else if (op === 'queue' || op === 'queue-up') {
        var q = (team(ME).queue || []).slice(), i = q.indexOf(k);
        if (op === 'queue-up' && i > 0) { q.splice(i, 1); q.splice(i - 1, 0, k); }
        else if (i >= 0) q.splice(i, 1); else q.push(k);
        act('draft-queue', { queue: q });
      }
      else if (op === 'draft-start') {
        modal('Start the draft now?', '<p class="muted">' + (L.size - E.humans(L).length) + ' empty seat' + (L.size - E.humans(L).length === 1 ? '' : 's') + ' will go to bots. Everyone picks in snake order with ' + L.draft.timer + ' seconds per pick.</p>', 'Start draft', function () { act('draft-start', {}); });
      }
      else if (op === 'copy-link') {
        var link = location.href.split('#')[0];
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(function () { toast('Link copied.'); }, function () { modal('Invite link', '<input class="fx-copy" readonly value="' + esc(link) + '" onclick="this.select()">'); });
      }
      else if (op === 'open-league') { e.preventDefault(); if (mount('home')) openLeague(a.dataset.id); else { session.league = a.dataset.id; store(SESSION, session); location.href = FX.froot + 'index.html#home'; } }
      else if (op === 'join-league') joinFlow(a.dataset.id);
      else if (op === 'create-league') createFlow();
      else if (op === 'draft-autodraft') {
        modal('Auto-draft the whole league?', '<p class="muted">For testing. The computer makes every remaining pick right away, for every team' + (L.status === 'open' ? ' (empty seats go to bots)' : '') + '. This can’t be undone.</p>', 'Auto-draft now', function () { act('draft-autodraft', {}); });
      }
      else if (op === 'signout') signOut();
      else if (op === 'leave-league') {
        var solo = E.humans(L).length === 1;
        modal('Leave ' + L.name + '?', '<p class="muted">' + (L.status === 'open' ? 'Your seat opens up again.' : 'A bot takes over your team.') + (isCommish() && !solo ? ' Another manager becomes commissioner.' : '') + ' Your account stays, with your other leagues.</p>', 'Leave league', function () {
          leagueCall('leave', 'You left the league.');
        }, true);
      }
      else if (op === 'delete-league') {
        modal('Delete ' + L.name + '?', '<p class="muted">The league is removed for everyone in it. This can’t be undone.</p>', 'Delete league', function () {
          leagueCall('delete-league', 'The league was deleted.');
        }, true);
      }
      else if (op === 'delete-account') {
        modal('Delete your account?', '<p class="muted">You leave every league you’re in (bots take over your teams) and your account is deleted. This can’t be undone.</p>', 'Delete account', function () {
          api({ action: 'delete', user: session.user, hash: session.hash }).then(function (r) {
            if (!r.ok) throw new Error(r.error);
            store(CACHE + session.user.toLowerCase(), undefined); signOut(); toast('Your account was deleted.');
          }).catch(function () { toast('Couldn’t reach the league server. Try again.'); });
        }, true);
      }
      return;
    }
    var o = e.target.closest('[data-owner]');
    if (o) { pstate.owner = o.dataset.owner; $$('[data-owner]').forEach(function (b) { b.classList.toggle('active', b === o); }); drawPlayers(); return; }
    var pos = e.target.closest('[data-pos]');
    if (pos && pos.closest('.fx-pos-chips')) { pstate.pos = pos.dataset.pos; $$('.fx-pos-chips .chip').forEach(function (b) { b.classList.toggle('active', b === pos); }); drawPlayers(); return; }
    var dpos = e.target.closest('[data-dpos]');
    if (dpos) { dstate.pos = dpos.dataset.dpos; $$('[data-dpos]').forEach(function (b) { b.classList.toggle('active', b === dpos); }); drawDraftPlayers(); return; }
    var th = e.target.closest('th[data-sort]');
    if (th && mount('players') && !mount('players').hidden) {
      var s = th.dataset.sort;
      pstate.dir = pstate.sort === s ? -pstate.dir : (s === 'rk' ? 1 : -1); pstate.sort = s;
      VIEWS.players([]); return;
    }
    var lf = e.target.closest('[data-lfilter]');
    if (lf) { leagueFilter = lf.dataset.lfilter; VIEWS.leagues(); return; }
    var tab = e.target.closest('[data-auth-tab]');
    if (tab) {
      $$('[data-auth-tab]').forEach(function (b) { b.classList.toggle('active', b === tab); b.setAttribute('aria-selected', b === tab); });
      $$('form[data-auth]').forEach(function (f) { f.hidden = f.dataset.auth !== tab.dataset.authTab; });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.closest('.fx-md-body') || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    var ok = $('[data-md-ok]'); if (ok && !ok.hidden && !ok.disabled) ok.click();
  });
  document.addEventListener('input', function (e) {
    if (e.target.matches('[data-p-search]')) { pstate.q = e.target.value.trim().toLowerCase(); drawPlayers(); }
    if (e.target.matches('[data-d-search]')) { dstate.q = e.target.value.trim().toLowerCase(); drawDraftPlayers(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.matches('[data-p-team]')) { pstate.team = e.target.value; drawPlayers(); }
    if (e.target.matches('[data-pick]')) { tradeState[e.target.dataset.pick][e.target.value] = e.target.checked; tradeHint(); }
    if (e.target.matches('[data-trade-other]')) { tradeState.other = e.target.value; tradeState.get = {}; VIEWS.trades([]); }
    if (e.target.matches('input[name=privacy]')) { var pf = $('[data-pass-field]'); if (pf) pf.hidden = e.target.value !== 'private'; }
    if (e.target.matches('[data-tx-f]')) { txFilter[e.target.dataset.txF] = e.target.value; filterTx(); }
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.matches('[data-team-form]')) {
      e.preventDefault();
      act('rename', { name: f.team.value.trim(), manager: f.manager.value.trim(), color: f.color.value }, header);
      return;
    }
    if (f.matches('[data-draft-form]')) {
      e.preventDefault();
      var at = f.startAt.value ? new Date(f.startAt.value).getTime() : null;
      act('draft-settings', { timer: +f.timer.value, size: +f.size.value, startAt: at });
      return;
    }
    if (!f.matches('form[data-auth]')) return;
    e.preventDefault();
    var err = $('[data-auth-error]', f);
    var btn = $('button[type=submit]', f);
    var label = btn.innerHTML;
    var fail = function (code) { err.textContent = LOGIN_ERRORS[code] || code; err.hidden = false; btn.disabled = false; btn.innerHTML = label; };
    err.hidden = true;
    var user = f.user.value.trim(), pw = f.password.value;
    if (!ACCOUNT_RE.test(user)) return fail('Usernames are 3 to 20 letters, numbers, _ or .');
    var done = function (res) {
      session = res.session; store(SESSION, session);
      L = null; ME = null; MINE = [];
      setState(res.r);
      openLeague(session.league);
    };
    var oops = function (x) { fail(x.message === 'Failed to fetch' || x.name === 'TypeError' ? 'unreachable' : x.message); };
    if (f.dataset.auth === 'create') {
      if (pw.length < 8) return fail('Passwords need at least 8 characters.');
      btn.disabled = true; btn.textContent = 'Creating your account…';
      createAccount(user, pw).then(function (res) { done(res); toast('Welcome! Join a league or create your own.'); }).catch(oops);
    } else {
      btn.disabled = true; btn.textContent = 'Signing in…';
      signIn(user, pw).then(function (res) { done(res); toast('Signed in.'); }).catch(oops);
    }
  });

  route();
  if (session && P) {
    api({ action: 'load', user: session.user, hash: session.hash, league: session.league || undefined }).then(function (r) {
      if (!r.ok) {
        if (r.error === 'no_league') { toast('That league is gone.'); openLeague(null); return; }
        if (r.error === 'wrong_login' || r.error === 'bad_account') signOut();
        return;
      }
      setState(r); route();
    }).catch(function () {}).then(function () { schedulePoll(); });
  }
})();
