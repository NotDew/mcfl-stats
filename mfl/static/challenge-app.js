(function () {
  'use strict';
  var C18 = window.C18 || {};
  var E = window.Challenge18;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var SESSION = 'mssn18Session';
  var FANTASY_SESSION = 'mssnFantasySession3';
  var LOCAL_DB = 'mssn18LocalRuns';
  var DRAFT = 'mssn18Draft', OUTBOX = 'mssn18Outbox';
  var SOUND = 'mssn18Sound';
  var root = $('#c18'), screen = $('[data-screen]', root);
  var DATA = null, VIEW = null, byKey = {};
  var session = null, me = null;
  var state = { view: 'home', run: null, draft: null, busy: false, flash: null, season: null, mode: null, board: {}, players: {} };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function save(key, val) {
    try { if (val === undefined) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
  }
  function num(n) { return Math.round(n || 0).toLocaleString('en-US'); }
  function f1(n) { return (Math.round((n || 0) * 10) / 10).toFixed(1); }
  function dash(w, l) { return w + '–' + l; }
  function ago(ms) {
    var d = new Date(ms);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function asset(u) { return !u ? '' : /^(https?:)?\/\//.test(u) ? u : (C18.root || '../') + u; }
  function tierOf(o) {
    var t = (VIEW && VIEW.tiers) || [[95, 'Elite'], [90, 'Excellent'], [85, 'Very Good'], [80, 'Good'], [75, 'Above Average'], [70, 'Average'], [60, 'Below Average'], [0, 'Poor']];
    for (var i = 0; i < t.length; i++) if (o >= t[i][0]) return t[i][1];
    return 'Poor';
  }
  function tierClass(o) { return o >= 95 ? 't-elite' : o >= 90 ? 't-exc' : o >= 85 ? 't-vg' : o >= 80 ? 't-good' : o >= 70 ? 't-avg' : 't-low'; }
  function posLabel(p) { return (VIEW && VIEW.labels[p]) || p; }
  function teamOf(season, name) {
    var S = VIEW && VIEW.seasons[season];
    return (S && S.teams.filter(function (t) { return t.n === name; })[0]) || { n: name, color: '#6f7a9c' };
  }
  function teamMark(season, name, cls) {
    var t = teamOf(season, name);
    var inner = t.logo ? '<img src="' + esc(asset(t.logo)) + '" alt="" loading="lazy">' : esc(String(name || '?').slice(0, 1));
    return '<span class="c18-team-mark ' + (cls || '') + '" style="--c:' + esc(t.color || '#6f7a9c') + '">' + inner + '</span>';
  }
  function player(season, k) { return (byKey[season] || {})[k] || null; }

  var LEAGUE_PREFIX = { MCFL: '', MFL: 'mfl-' }, DATAS = {}, VIEWS = {}, KEYS = {};
  function leagueOf(x) { return x && x.league === 'MFL' ? 'MFL' : 'MCFL'; }
  function loadLeague(code) {
    if (DATAS[code]) return Promise.resolve();
    var pre = 'data/' + LEAGUE_PREFIX[code], json = function (r) { if (!r.ok) throw new Error('no_league'); return r.json(); };
    return Promise.all([fetch(pre + 'server.json').then(json), fetch(pre + 'view.json').then(json)]).then(function (x) {
      if (!x[1].order || !x[1].order.length) throw new Error('no_league');
      var keys = {};
      Object.keys(x[1].seasons).forEach(function (id) { keys[id] = {}; x[1].seasons[id].players.forEach(function (p) { keys[id][p.k] = p; }); });
      DATAS[code] = x[0]; VIEWS[code] = x[1]; KEYS[code] = keys;
    });
  }
  function useLeague(code) {
    code = code === 'MFL' ? 'MFL' : 'MCFL';
    return loadLeague(code).then(function () {
      if (state.league !== code) { state.league = code; state.season = DATAS[code].current; }
      DATA = DATAS[code]; VIEW = VIEWS[code]; byKey = KEYS[code];
    });
  }
  function hasMfl() { return !!DATAS.MFL; }
  function modeIds() { return (C18.mode_order || Object.keys(C18.modes || {})).filter(function (id) { return C18.modes[id]; }); }
  function modeLabel(id) { var m = (C18.modes || {})[id]; return m ? m.label : id; }
  function seasonLabel(id) { var S = VIEW && VIEW.seasons[id]; return S ? S.label : 'Season ' + id; }
  function youName(run) { return run ? run.name : 'You'; }

  var toastTimer;
  function toast(msg) {
    var t = $('[data-toast]'); if (!t || !msg) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3600);
  }
  function modal(html) {
    var m = $('[data-modal]');
    $('[data-modal-body]', m).innerHTML = html;
    m.hidden = false;
    document.body.classList.add('c18-locked');
  }
  function closeModal() {
    var m = $('[data-modal]');
    m.hidden = true;
    document.body.classList.remove('c18-locked');
  }

  var audio = null, soundOn = load(SOUND) !== false;
  function beep(freq, dur, vol, type) {
    if (!soundOn) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
      o.type = type || 'square'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.04, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + dur);
    } catch (e) {}
  }
  function chime(good) {
    [0, 120, 240].forEach(function (d, i) { setTimeout(function () { beep(good ? [523, 659, 784][i] : [392, 330, 262][i], 0.35, 0.05, 'triangle'); }, d); });
  }
  function drawSound() {
    var b = $('[data-sound]', root);
    b.setAttribute('aria-pressed', soundOn ? 'true' : 'false');
    b.textContent = soundOn ? '🔊 Sound' : '🔇 Muted';
  }

  var localServer = null;
  function api(body, waitMs) {
    body.data = new URL('data/server.json', location.href).href;
    if (C18.cloud) {
      var ctl = window.AbortController ? new AbortController() : null, timer = ctl && setTimeout(function () { ctl.abort(); }, waitMs || 60000);
      return fetch(C18.cloud, { method: 'POST', body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined })
        .catch(function (e) { throw new Error(e && e.name === 'AbortError' ? 'timeout' : 'unreachable'); })
        .finally(function () { clearTimeout(timer); })
        .then(function (r) { return r.text().then(function (t) { return { status: r.status, text: t }; }); })
        .then(function (x) {
          try { return JSON.parse(x.text); } catch (e) {
            var err = new Error('not_json');
            err.detail = googleError(x.text) || ('HTTP ' + x.status);
            throw err;
          }
        });
    }
    if (!localServer) localServer = E.server(localStore());
    return new Promise(function (resolve) { setTimeout(function () { resolve(JSON.parse(JSON.stringify(localServer(body)))); }, 0); });
  }
  function googleError(html) {
    var doc;
    try { doc = new DOMParser().parseFromString(String(html || ''), 'text/html'); } catch (e) { return ''; }
    var box = doc.querySelector('.errorMessage, #errorMessage, .error-message') || doc.body;
    var text = ((box && box.textContent) || '').replace(/\s+/g, ' ').trim();
    return text.length > 220 ? text.slice(0, 220) + '…' : text;
  }
  function accountsApi(body) {
    return fetch(C18.accounts, { method: 'POST', body: JSON.stringify(body) })
      .catch(function () { throw new Error('unreachable'); })
      .then(function (r) { return r.text(); })
      .then(function (t) { try { return JSON.parse(t); } catch (e) { throw new Error('not_json'); } });
  }
  function localStore() {
    var db = function () { return load(LOCAL_DB) || { runs: {}, order: [] }; };
    return {
      now: function () { return Date.now(); }, sleep: function () {}, random: Math.random,
      lock: function (fn) { return fn(); },
      account: function (key) { return { key: key, user: (session && session.user) || 'You', salt: '', hash: 'local' }; },
      run: function (id) { var r = db().runs[id]; return r ? JSON.parse(JSON.stringify(r)) : null; },
      saveRun: function (run) {
        var d = db();
        if (!d.runs[run.id]) d.order.push(run.id);
        d.runs[run.id] = run;
        while (d.order.length > 60) delete d.runs[d.order.shift()];
        save(LOCAL_DB, d);
      },
      runsOf: function (key) { var d = db(); return d.order.slice().reverse().map(function (id) { return E.summary(d.runs[id]); }).filter(function (s) { return s.user === key; }); },
      board: function () { var d = db(); return d.order.map(function (id) { return E.summary(d.runs[id]); }).filter(function (s) { return s.status === 'done'; }); },
      newRunId: function () { return 'R' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36); },
      sign: function (text) { return 'local:' + text; },
      dataUrl: function (u) { return u || 'data/server.json'; },
      data: function (url) { return /mfl-server\.json$/.test(url) ? DATAS.MFL : DATAS.MCFL; }
    };
  }
  var ERRORS = {
    wrong_login: 'That username and password don’t match.', no_account: 'No account with that username.',
    bad_account: 'Usernames are 3 to 20 letters, numbers, _ or .', taken: 'That username is taken. Pick another, or sign in.',
    unreachable: 'Couldn’t reach the challenge server. Check your connection and try again.',
    timeout: 'The challenge server took too long to answer. Try again.',
    not_json: 'Google sent back an error page instead of an answer.',
    no_data: 'The challenge server couldn’t load the player list. Try again in a minute.',
    already_spun: 'You already have a team for this spot. Pick a player first.', no_rerolls: 'No respins left.',
    not_on_team: 'That player isn’t on the team you drew.', slot_filled: 'That spot is already filled. Pick another.', cant_play: 'That player isn’t rated at that position.', already_picked: 'You already have that player.',
    no_players: 'Nobody is left who can play this spot.', no_run: 'That run doesn’t exist, or isn’t finished yet.',
    slow_down: 'That’s a lot of runs today. Take a break and come back tomorrow.', bad_season: 'That season isn’t available any more.',
    already_played: 'This run is already finished.', not_drafting: 'This run isn’t drafting any more. Reload the page.',
    server: 'The challenge server had a problem. Try again.', bad_request: 'That didn’t work. Reload the page and try again.',
    old_server: 'The challenge server needs updating: paste the new Apps Script files and deploy a new version.',
    bad_ticket: 'The server couldn’t check this run, so it wasn’t saved.', old_ticket: 'This run was started too long ago to be saved.',
    not_finished: 'This run isn’t finished.'
  };
  function need(r) {
    if (r.ok) return r;
    var e = new Error(r.error || 'server');
    if (r.error === 'server' && r.detail) e.detail = r.detail;
    throw e;
  }
  function errText(e) {
    var m = ERRORS[e && e.message] || ERRORS.server;
    return e && e.detail ? m + ' (' + e.detail + ')' : m;
  }
  function authed(body, waitMs) { body.user = session.user; body.hash = session.hash; return api(body, waitMs).then(need); }

  function b64(bytes) { return btoa(String.fromCharCode.apply(null, new Uint8Array(bytes))); }
  function hashPassword(password, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']).then(function (key) {
      return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: C18.iterations || 310000 }, key, 256);
    }).then(b64);
  }

  function refreshMe() {
    if (!session) { me = null; return Promise.resolve(null); }
    return authed({ action: 'me' }).then(function (r) {
      var have = {};
      (r.runs || []).forEach(function (x) { have[x.id] = true; });
      var waiting = outbox().map(function (dr) { return unsaved[dr.id]; }).filter(function (x) { return x && !have[x.id]; });
      r.runs = waiting.concat((r.runs || []).filter(function (x) { return x.status === 'done'; }));
      me = r;
      session.user = r.user;
      return r;
    }).catch(function (e) {
      if (e.message === 'wrong_login' || e.message === 'no_account') { signOut(true); }
      throw e;
    });
  }
  function signIn(user, password) {
    return api({ action: 'salt', user: user }).then(need).then(function (r) { return hashPassword(password, r.salt); })
      .then(function (hash) { session = { user: user, hash: hash }; return refreshMe(); })
      .then(function () { save(SESSION, session); afterSignIn(); });
  }
  function createAccount(user, password) {
    var a = new Uint8Array(16); crypto.getRandomValues(a);
    var salt = b64(a);
    return hashPassword(password, salt).then(function (hash) {
      return accountsApi({ action: 'register', user: user, salt: salt, hash: hash }).then(need).then(function () {
        session = { user: user, hash: hash };
        save(SESSION, session);
        return refreshMe().then(function (r) { afterSignIn(); return r; });
      });
    });
  }
  function signOut(quiet) {
    session = null; me = null; save(SESSION, undefined);
    state.run = null; state.draft = null;
    if (!quiet) { drawAccount(); go('home'); }
  }
  function drawAccount() {
    var el = $('[data-account]', root);
    if (!C18.cloud) { el.innerHTML = '<span class="c18-acct-note" title="No challenge server is set up yet, so runs are kept in this browser only.">This device only</span>'; return; }
    el.innerHTML = session
      ? '<span class="c18-acct-name">' + esc(session.user) + '</span><button class="c18-link" type="button" data-act="signout">Sign out</button>'
      : '<button class="btn btn-ghost c18-btn-sm" type="button" data-go="home">Sign in</button>';
  }

  function acctKey() { return session ? session.user.toLowerCase() : 'you'; }
  function transient(e) { return e && /^(not_json|unreachable|timeout)$/.test(e.message); }
  function retry(fn, tries, wait) {
    wait = wait || 1200;
    return fn().catch(function (e) {
      if (!transient(e) || tries <= 1) throw e;
      return sleep(wait).then(function () { return retry(fn, tries - 1, Math.min(wait * 2, 8000)); });
    });
  }
  function ticket() {
    if (!session) return Promise.reject(new Error('wrong_login'));
    var seed;
    try { seed = crypto.getRandomValues(new Uint32Array(1))[0]; } catch (e) { seed = Math.floor(Math.random() * 4294967296); }
    return Promise.resolve({ seed: seed, t: Date.now(), sig: 'client' });
  }
  function afterSignIn() { loadDraft(); sendOutbox(); }

  function saveDraft(dr) { save(DRAFT + ':' + acctKey(), dr || undefined); state.draft = dr || null; }
  function loadDraft() { state.draft = load(DRAFT + ':' + acctKey()); return state.draft; }
  function runOf(dr) {
    return E.replay(DATAS[leagueOf(dr)], { id: dr.id, league: leagueOf(dr), season: dr.season, mode: dr.mode,
      user: acctKey(), name: session ? session.user : 'You', now: dr.t, seed: dr.seed, moves: dr.moves });
  }
  function resumeDraft() {
    var dr = state.draft;
    if (!dr) return Promise.resolve(null);
    return useLeague(leagueOf(dr)).then(function () {
      state.run = runOf(dr);
      return state.run;
    }).catch(function () { saveDraft(null); state.run = null; return null; });
  }
  function startRun(league, season, mode) {
    if (state.busy) return;
    state.busy = true;
    var slow = setTimeout(function () { screen.innerHTML = '<div class="card c18-empty"><strong>Starting&hellip;</strong><span>Getting your draws from the challenge server.</span></div>'; }, 120);
    Promise.all([ticket(), useLeague(league)]).then(function (x) {
      clearTimeout(slow);
      var t = x[0];
      var dr = { id: E.ticketRunId(t), seed: t.seed, t: t.t, sig: t.sig, league: league, season: season || state.season, mode: mode, moves: [] };
      var run = runOf(dr);
      saveDraft(dr);
      state.busy = false; state.run = run; state.flash = null; state.confettiDone = false;
      state.season = run.season; state.mode = run.mode;
      if (state.view !== 'home') { state.view = 'home'; history.pushState(null, '', location.pathname); }
      window.scrollTo(0, 0);
      drawPlay();
    }).catch(function (e) { clearTimeout(slow); state.busy = false; state.run = null; toast(errText(e)); drawStart(); });
  }
  function applyMove(m) {
    var dr = state.draft;
    dr.moves.push(m);
    var run;
    try { run = runOf(dr); } catch (e) { dr.moves.pop(); throw e; }
    saveDraft(dr);
    state.run = run;
    return run;
  }

  function outbox() { return load(OUTBOX + ':' + acctKey()) || []; }
  function setOutbox(list) { save(OUTBOX + ':' + acctKey(), list.length ? list : undefined); }
  var saveState = {}, sending = false;
  var unsaved = {};
  function finishRun(run) {
    var dr = state.draft;
    saveDraft(null);
    setOutbox(outbox().filter(function (x) { return x.id !== dr.id; }).concat([dr]));
    unsaved[run.id] = E.summary(run);
    if (me) me.runs = [unsaved[run.id]].concat((me.runs || []).filter(function (s) { return s.id !== run.id; }));
    saveState[run.id] = 'saving';
    sendOutbox();
  }
  function sendOutbox() {
    if (sending || !session) return;
    var list = outbox();
    if (!list.length) return;
    var dr = list[0], key = acctKey();
    sending = true;
    saveState[dr.id] = 'saving'; drawSaveNote(dr.id);
    retry(function () {
      return authed({ action: 'submit', ticket: { seed: dr.seed, t: dr.t, sig: dr.sig }, league: leagueOf(dr), season: dr.season, mode: dr.mode, moves: dr.moves });
    }, 4).then(function (r) {
      sending = false;
      if (acctKey() !== key) return;
      setOutbox(outbox().filter(function (x) { return x.id !== dr.id; }));
      saveState[dr.id] = 'saved';
      if (me) me.runs = [E.summary(r.run)].concat((me.runs || []).filter(function (s) { return s.id !== r.run.id; }));
      var showing = state.run && state.run.id === r.run.id;
      if (showing) {
        var changed = state.run.record.w !== r.run.record.w || state.run.record.l !== r.run.record.l || !!r.run.unique !== !!state.run.unique;
        state.run = r.run;
        if (changed && state.view === 'home' && $('.c18-final', screen)) drawFinal(r.run, true);
      }
      drawSaveNote(dr.id);
      sendOutbox();
    }, function (e) {
      sending = false;
      if (acctKey() !== key) return;
      if (transient(e)) { saveState[dr.id] = 'retry'; drawSaveNote(dr.id); setTimeout(sendOutbox, 15000); return; }
      if (e && e.message === 'bad_ticket' && dr.sig === 'client') { saveState[dr.id] = 'retry'; drawSaveNote(dr.id); setTimeout(sendOutbox, 300000); return; }
      setOutbox(outbox().filter(function (x) { return x.id !== dr.id; }));
      if (me) me.runs = (me.runs || []).filter(function (s) { return s.id !== dr.id; });
      saveState[dr.id] = errText(e); drawSaveNote(dr.id);
      sendOutbox();
    });
  }
  function saveNoteText(id) {
    var st = saveState[id];
    if (!C18.cloud || !st) return '';
    if (st === 'saving') return 'Saving to the leaderboard&hellip;';
    if (st === 'saved') return '✓ Saved to the leaderboard';
    if (st === 'retry') return 'Couldn&rsquo;t reach the server yet. It keeps trying (this page can stay open or be reloaded).';
    return esc(st);
  }
  function drawSaveNote(id) {
    var el = $('[data-save-note="' + id + '"]', screen);
    if (el) { el.innerHTML = saveNoteText(id); el.className = 'c18-save-note ' + (saveState[id] === 'saved' ? 'ok' : ''); }
  }

  function go(view, push) {
    state.view = view;
    var hash = view === 'home' ? '' : view === 'run' ? '#run=' + state.replayId : '#' + view;
    if (push !== false && location.hash !== hash) history.pushState(null, '', hash || location.pathname);
    route();
  }
  function fromHash() {
    var h = location.hash.slice(1);
    if (/^run=/.test(h)) { state.view = 'run'; state.replayId = h.slice(4); }
    else if (h === 'board' || h === 'players' || h === 'runs' || h === 'how') state.view = h;
    else state.view = 'home';
  }
  function route() {
    $$('.c18-nav-link', root).forEach(function (a) {
      var on = a.getAttribute('data-go') === (state.view === 'home' ? 'home' : state.view);
      a.classList.toggle('active', on);
    });
    closeModal();
    window.scrollTo(0, 0);
    if (state.view === 'board') return drawBoard();
    if (state.view === 'players') return drawPlayers();
    if (state.view === 'runs') return drawRuns();
    if (state.view === 'how') return drawHow();
    if (state.view === 'run') return drawReplay();
    return drawPlay();
  }

  function drawPlay() {
    if (C18.cloud && !session) return drawSignIn();
    var run = state.run;
    if (run && leagueOf(run) !== state.league) {
      return useLeague(leagueOf(run)).then(drawPlay, function () { state.run = null; drawStart(); });
    }
    if (run && run.status === 'drafting') return drawDraft();
    if (run && run.status === 'done') return drawFinal(run, true);
    return drawStart();
  }

  function drawSignIn() {
    screen.innerHTML = hero() +
      '<div class="card c18-signin"><h2>Sign in to play</h2>' +
      '<p class="muted">Use your MSSN Fantasy account. Every run is saved to your name and can make the leaderboard.</p>' +
      '<form data-form="signin" class="c18-form">' +
      '<label>Username<input name="user" autocomplete="username" required maxlength="20"></label>' +
      '<label>Password<input name="password" type="password" autocomplete="current-password" required></label>' +
      '<div class="c18-form-msg" data-msg></div>' +
      '<div class="c18-row"><button class="btn btn-primary" type="submit">Sign in</button>' +
      (C18.accounts ? '<button class="btn btn-ghost" type="button" data-act="create">Create an account</button>' : '') + '</div>' +
      '</form></div>';
  }
  function hero(small) {
    return '<div class="c18-hero' + (small ? ' sm' : '') + '"><div class="eyebrow">' + esc(state.league || 'MCFL') + ' &middot; ' + esc(seasonLabel(state.season || (DATA && DATA.current))) + '</div>' +
      '<h1 class="c18-title">17&ndash;0 <span>Challenge</span></h1>' +
      '<p class="c18-tag">Draft six real players. Go 17&ndash;0.</p></div>';
  }

  function drawStart() {
    var active = state.draft && !state.run ? state.draft : null;
    var seasons = (VIEW.order || []).map(function (id) {
      return '<option value="' + esc(id) + '"' + (id === state.season ? ' selected' : '') + '>' + esc(seasonLabel(id)) + (VIEW.seasons[id].current ? ' (this season)' : '') + '</option>';
    }).join('');
    var modes = modeIds().map(function (id) {
      var m = C18.modes[id];
      return '<button type="button" class="c18-mode' + (id === state.mode ? ' active' : '') + '" data-mode="' + esc(id) + '">' +
        '<strong>' + esc(m.label) + '</strong><span>' + esc(m.about || '') + '</span>' +
        '<em>' + (m.rerolls ? m.rerolls + ' respin' + (m.rerolls === 1 ? '' : 's') : 'No respins') + '</em></button>';
    }).join('');
    var slots = (C18.roster || []).map(function (p) { return '<span class="c18-chip">' + esc(p) + '</span>'; }).join('');
    screen.innerHTML = hero() +
      (active ? '<div class="card c18-resume"><div><strong>You have a run in progress</strong><span class="muted">' +
        esc(leagueOf(active)) + ' &middot; ' + esc(seasonLabel(active.season)) + ' &middot; ' + esc(modeLabel(active.mode)) + ' &middot; ' + active.moves.filter(function (m) { return m[0] === 'p'; }).length + ' of ' + C18.roster.length + ' picked</span></div>' +
        '<button class="btn btn-primary" type="button" data-act="resume">Resume run</button></div>' : '') +
      '<div class="c18-start">' +
      '<div class="card c18-setup"><h2>Your run</h2>' +
      (hasMfl() ? '<div class="c18-field"><span>League</span><div class="c18-league">' + ['MCFL', 'MFL'].map(function (code) {
        return '<button type="button" class="c18-league-btn' + (code === state.league ? ' active' : '') + '" data-league="' + code + '">' + code + '</button>';
      }).join('') + '</div></div>' : '') +
      '<label class="c18-field"><span>Stats from</span><select data-season>' + seasons + '</select></label>' +
      '<p class="muted c18-note">The season decides every player&rsquo;s rating, which teams can come up and how good they are.</p>' +
      '<div class="c18-field"><span>Mode</span><div class="c18-modes">' + modes + '</div></div>' +
      '<div class="c18-field"><span>Roster</span><div class="c18-chips">' + slots + '</div></div>' +
      '<button class="btn btn-primary c18-big" type="button" data-act="start">' + (active ? 'Start a new run' : 'Start') + '</button>' +
      (active ? '<p class="muted c18-note">Starting a new run gives up the one in progress.</p>' : '') +
      '</div>' +
      '<div class="card c18-loop"><h2>How a run goes</h2><ol>' +
      '<li><strong>Draw.</strong> The logo shuffles and lands on a random ' + esc(state.league) + ' team.</li>' +
      '<li><strong>Pick.</strong> Take any of that team&rsquo;s players for any spot you still need.</li>' +
      '<li><strong>Build.</strong> Six spots (QB, two WRs, three DEF), six draws. Nobody twice.</li>' +
      '<li><strong>Play.</strong> A ' + (DATA.config.simulation.regular_season_games || 17) + '-game season, straight to your record and grade.</li></ol></div>' +
      '</div>';
  }

  var SHUFFLE_MS = 2000;
  var shown = {};
  function reelTeams(season) {
    var C = E.context(DATA, season), w = (DATA.config.wheel || {}).team_weights || {};
    return C.teams.filter(function (t) { var x = w[t]; return x == null || +x > 0; });
  }
  function preloadLogos(season) {
    if (shown[season]) return;
    shown[season] = true;
    reelTeams(season).forEach(function (n) { var t = teamOf(season, n); if (t.logo) { var i = new Image(); i.src = asset(t.logo); } });
  }
  function reelHtml(season, team) {
    return '<div class="c18-reel" data-reel aria-live="polite">' +
      '<div class="c18-reel-tile" data-reel-tile>' + reelFace(season, team) + '</div>' +
      '<strong class="c18-reel-name" data-reel-name>' + (team ? esc(team) : '&nbsp;') + '</strong></div>';
  }
  function reelFace(season, team) {
    if (!team) return '<span class="c18-reel-q">?</span>';
    var t = teamOf(season, team);
    return '<span class="c18-reel-face" style="--c:' + esc(t.color || '#6f7a9c') + '">' +
      (t.logo ? '<img src="' + esc(asset(t.logo)) + '" alt="">' : '<b>' + esc(String(team).slice(0, 1)) + '</b>') + '</span>';
  }
  function showOnReel(season, team, final) {
    var tile = $('[data-reel-tile]', screen), name = $('[data-reel-name]', screen);
    if (!tile) return;
    tile.innerHTML = reelFace(season, team);
    name.textContent = team || '';
    var reel = $('[data-reel]', screen);
    reel.classList.toggle('landed', !!final);
    reel.classList.toggle('rolling', !final);
  }
  function shuffleTo(season, answer, ms, alive) {
    var teams = reelTeams(season), t0 = Date.now(), target = null, failed = null, last = null;
    answer.then(function (team) { target = team; }, function (e) { failed = e || new Error('server'); });
    var slow = [110, 150, 200, 270, 360];
    function pickOther() {
      if (teams.length < 2) return teams[0];
      var n;
      do { n = teams[Math.floor(Math.random() * teams.length)]; } while (n === last);
      return n;
    }
    return new Promise(function (resolve, reject) {
      function flick() {
        if (failed || !alive()) { reject(failed || new Error('gone')); return; }
        if (target && Date.now() - t0 >= ms - 1090) { settle(0); return; }
        last = pickOther();
        showOnReel(season, last, false);
        beep(900 + Math.random() * 200, 0.02, 0.02);
        setTimeout(flick, 70);
      }
      function settle(i) {
        if (!alive()) { reject(new Error('gone')); return; }
        if (i === slow.length) { showOnReel(season, target, true); resolve(target); return; }
        do { last = pickOther(); } while (teams.length > 2 && last === target);
        showOnReel(season, last, false);
        beep(900 + Math.random() * 200, 0.025, 0.025);
        setTimeout(function () { settle(i + 1); }, slow[i]);
      }
      flick();
    });
  }

  function lastSpin(run) { return run.spins[run.spins.length - 1]; }
  function filledAt(run, i) { return run.roster.filter(function (x) { return x.slot === i; })[0] || null; }
  function openPositions(run) {
    var seen = {};
    return E.openSlots(run).map(function (o) { return o[1]; }).filter(function (p) { return seen[p] ? false : (seen[p] = true); });
  }
  function offerSpots(run, o, spin) {
    var at = E.offerAt(o, spin), open = openPositions(run);
    return open.filter(function (p) { return at[p]; }).map(function (p) { return [p, at[p][0], at[p][1]]; })
      .sort(function (a, b) { return b[1] - a[1]; });
  }
  function bestRating(o, spin) {
    var at = E.offerAt(o, spin);
    return Math.max.apply(null, Object.keys(at).map(function (p) { return at[p][0]; }));
  }
  function rosterStrip(run) {
    return '<div class="c18-roster">' + run.slots.map(function (pos, i) {
      var x = filledAt(run, i);
      var cls = x ? 'done' : run.status === 'drafting' ? 'now' : '';
      return '<div class="c18-slot ' + cls + '"><span class="c18-slot-pos">' + esc(pos) + '</span>' +
        (x ? '<span class="c18-slot-name">' + esc(x.n) + '</span><span class="c18-slot-ovr ' + tierClass(x.ovr) + '">' + x.ovr + '</span>'
          : '<span class="c18-slot-name muted">Open</span>') + '</div>';
    }).join('') + '</div>';
  }
  function drawDraft() {
    var run = state.run, landed = run.pending, open = openPositions(run);
    var flash = state.flash; state.flash = null;
    var failed = state.spinError; state.spinError = null;
    preloadLogos(run.season);
    var html = '<div class="c18-draft">' +
      '<div class="c18-draft-head"><div><div class="eyebrow">' + esc(seasonLabel(run.season)) + ' &middot; ' + esc(run.modeLabel) + '</div>' +
      '<h1 class="c18-pos-title c18-open-title"><small>Open spots</small>' + open.map(esc).join(' &middot; ') + '</h1></div>' +
      '<div class="c18-draft-meta"><span>Pick ' + (run.slot + 1) + ' of ' + run.slots.length + '</span>' +
      (run.rerollsStart ? '<span>' + run.rerolls + ' respin' + (run.rerolls === 1 ? '' : 's') + ' left</span>' : '') +
      '<button class="c18-link" type="button" data-act="abandon">Give up run</button></div></div>' +
      (flash ? '<div class="c18-flash"><strong>✓ ' + esc(flash.pos) + ' COMPLETE</strong><span>' + esc(flash.n) + ' &mdash; ' + flash.ovr + ' OVR</span><em>Still open: ' + open.map(esc).join(', ') + '</em></div>' : '') +
      rosterStrip(run) +
      '<div class="c18-stage">' +
      '<div class="c18-reel-col">' + reelHtml(run.season, landed) +
      '<div class="c18-spin-row" data-spin-row>' + (landed ? landedHtml(run) : failed ? '<button class="btn btn-primary" type="button" data-act="spin">Try again</button>' : '') + '</div>' +
      '<div class="c18-spin-msg" data-spin-msg>' + (failed ? '<strong>That didn&rsquo;t work</strong><span>' + esc(failed) + '</span>' : '') + '</div></div>' +
      '<div class="c18-offer" data-offer>' + (landed ? offerHtml(run) : '<div class="c18-offer-empty"><strong>Drawing a team&hellip;</strong><span>The logo lands on a random team. Take any of their players for any open spot.</span></div>') + '</div>' +
      '</div></div>';
    screen.innerHTML = html;
    if (landed) $('[data-reel]', screen).classList.add('landed');
    else {
      if (window.innerWidth <= 980) { var reel = $('[data-reel]', screen); if (reel && reel.scrollIntoView) reel.scrollIntoView({ block: 'center' }); }
    }
    if (!landed && !failed) {
      var id = run.id, slot = run.slot;
      setTimeout(function () {
        if (state.run && state.run.id === id && state.run.slot === slot && !state.run.pending && $('[data-reel]', screen)) doSpin(false);
      }, flash ? 600 : 150);
    }
  }
  function landedHtml(run) {
    return (run.rerolls > 0 ? '<button class="btn btn-ghost" type="button" data-act="reroll">Respin (' + run.rerolls + ' left)</button>' : '');
  }
  function offerHtml(run) {
    var s = lastSpin(run);
    var cards = (s.offer || []).map(function (o) { return offerCard(run, o, s); }).join('');
    return '<div class="c18-offer-head"><div>' + teamMark(run.season, run.pending) + '<h2>' + esc(run.pending) + '</h2></div><span>Pick a player for any open spot</span></div>' +
      '<div class="c18-cards">' + cards + '</div>';
  }
  function offerCard(run, o, spin) {
    var spots = offerSpots(run, o, spin), top = spots[0];
    if (!top) return '';
    var buttons = spots.map(function (x, i) {
      return '<button class="btn ' + (i ? 'btn-ghost' : 'btn-primary') + ' c18-btn-sm" type="button" data-act="choose" data-k="' + esc(o[0]) + '" data-pos="' + esc(x[0]) + '">' + esc(x[0]) + ' ' + x[1] + '</button>';
    }).join('');
    return playerCard(run.season, [o[0], o[1], top[1], top[2]], top[0], false, '<div class="c18-card-picks"><span class="muted">Play as</span>' + buttons + '</div>',
      spots.map(function (x) { return x[0]; }));
  }
  function playerCard(season, o, pos, selectable, extra, shows) {
    var p = player(season, o[0]), x = p && p.p[pos], ovr = o[2];
    var cells = function (y) { return y.s.map(function (s) { return '<div><b>' + esc(s[1]) + '</b><span>' + esc(s[0]) + '</span></div>'; }).join(''); };
    var list = (shows || [pos]).filter(function (q) { return p && p.p[q]; });
    var stats = list.length > 1
      ? list.map(function (q) { return '<div class="c18-card-side"><em>' + esc(E.isOffense(q) ? 'Offense' : 'Defense') + ' &middot; ' + esc(q) + ' ' + p.p[q].o + ' &middot; #' + p.p[q].rk + ' of ' + p.p[q].of + '</em><div class="c18-card-stats">' + cells(p.p[q]) + '</div></div>'; }).join('')
      : x ? '<div class="c18-card-stats">' + cells(x) + '</div>' : '';
    return '<article class="c18-card ' + tierClass(ovr) + '">' +
      '<div class="c18-card-top">' + (p ? p.av : '') + '<div class="c18-card-who"><strong>' + esc(o[1]) + '</strong><span>' + esc(pos) + ' &middot; ' + esc(p ? p.t : '') + '</span></div>' +
      '<button class="c18-ovr" type="button" data-act="explain" data-k="' + esc(o[0]) + '" data-pos="' + esc(pos) + '" title="Why this rating?"><b>' + ovr + '</b><span>OVR</span></button></div>' +
      '<div class="c18-card-tier"><span class="c18-tier">' + esc(tierOf(ovr)) + '</span>' + (o[3] ? '<span class="c18-prov" title="Fewer than ' + (DATA.config.ratings.full_games || 4) + ' games played, so this rating is lowered">Few games</span>' : '') +
      (x ? '<span class="muted">#' + x.rk + ' ' + esc(pos) + ' of ' + x.of + '</span>' : '') + '</div>' +
      '<div class="c18-card-body">' + stats + '</div>' +
      '<div class="c18-card-foot"><span class="muted">' + esc(seasonLabel(season)) + ' &middot; ' + (p ? p.gp : '?') + ' GP</span>' +
      (selectable ? '<button class="btn btn-primary c18-btn-sm" type="button" data-act="choose" data-k="' + esc(o[0]) + '">Select</button>' : '') + '</div>' +
      (extra || '') + '</article>';
  }
  function explain(season, k, pos) {
    var p = player(season, k);
    if (!p || !p.p[pos]) return;
    var x = p.p[pos], groups = {};
    x.c.forEach(function (c) { (groups[c[1]] = groups[c[1]] || []).push(c); });
    var summary = Object.keys(groups).map(function (g) {
      var list = groups[g], w = list.reduce(function (s, c) { return s + c[3]; }, 0);
      var v = Math.round(list.reduce(function (s, c) { return s + c[2] * c[3]; }, 0) / (w || 1));
      return '<div class="c18-comp-sum"><b>' + v + '</b><span>' + esc(g) + '</span></div>';
    }).join('');
    var rows = x.c.map(function (c) {
      return '<div class="c18-comp"><span>' + esc(c[0]) + ' <em>' + c[3] + '%</em></span><div class="c18-bar"><i style="width:' + c[2] + '%"></i></div><b>' + c[2] + '</b></div>';
    }).join('');
    var other = Object.keys(p.p).filter(function (q) { return q !== pos; }).map(function (q) { return esc(q) + ' ' + p.p[q].o; }).join(' &middot; ');
    modal('<div class="c18-explain"><div class="c18-explain-head">' + p.av + '<div><div class="eyebrow">Player overall</div><h2 id="c18-modal-title">' + esc(p.n) + ' &mdash; ' + x.o + '</h2>' +
      '<span class="muted">' + esc(posLabel(pos)) + ' &middot; ' + esc(p.t) + ' &middot; ' + esc(seasonLabel(season)) + '</span></div></div>' +
      '<div class="c18-comp-sums">' + summary + '</div>' +
      '<h3>Components</h3>' + rows +
      '<div class="c18-ranks"><div><span>Position rank</span><b>#' + x.rk + ' ' + esc(pos) + '</b><em>of ' + x.of + '</em></div><div><span>League rank</span><b>#' + p.lr + '</b><em>overall</em></div></div>' +
      '<p class="muted c18-note">Each part is how this player compares with every other ' + esc(posLabel(pos).toLowerCase()) + ' that season (99 is the best, 40 the lowest). Per-game numbers are pulled toward the average for players with few games, so one big game can&rsquo;t make a 99.' +
      (x.prov ? ' <strong>Few games:</strong> under ' + (DATA.config.ratings.full_games || 4) + ' games played, so this rating is lowered.' : '') + '</p>' +
      (other ? '<p class="muted c18-note">Also rated: ' + other + '</p>' : '') +
      (p.u ? '<a class="btn btn-ghost" href="' + esc(asset(p.u)) + '">Full stats page</a>' : '') + '</div>');
  }

  function doSpin(reroll) {
    if (state.busy) return;
    var run = state.run, before = run.spins.length, next;
    try { next = applyMove([reroll ? 'r' : 's']); } catch (e) { state.spinError = errText(e); drawDraft(); return; }
    state.busy = true;
    var row = $('[data-spin-row]', screen), msg = $('[data-spin-msg]', screen), offer = $('[data-offer]', screen);
    row.innerHTML = '';
    offer.innerHTML = '<div class="c18-offer-empty"><strong>Drawing a team&hellip;</strong><span>Please give me a good team.</span></div>';
    msg.innerHTML = '';
    if (reroll && window.innerWidth <= 980) { var reel = $('[data-reel]', screen); if (reel) reel.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    var spins = next.spins.slice(before), i = 0;
    function stillHere() { return state.run && state.run.id === run.id && state.view === 'home'; }
    function land(ms) {
      var s = spins[i];
      return shuffleTo(run.season, Promise.resolve(s.team), ms, stillHere).then(function () {
        if (!s.empty) { chime(true); return; }
        msg.innerHTML = '<strong>' + esc(s.team.toUpperCase()) + ' HAVE NOBODY FOR YOUR OPEN SPOTS</strong><span>Drawing again&hellip;</span>';
        beep(220, 0.25, 0.04, 'sawtooth');
        i++;
        return sleep(800).then(function () { msg.innerHTML = ''; return land(1200); });
      });
    }
    land(SHUFFLE_MS).then(function () { return sleep(250); }).then(function () {
      state.busy = false;
      if (!stillHere()) return;
      drawDraft();
      if (window.innerWidth <= 980) { var o = $('[data-offer]', screen); if (o) o.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    }, function () { state.busy = false; if (stillHere()) drawDraft(); });
  }
  function choose(k, pos) {
    if (state.busy) return;
    var run = state.run, s = lastSpin(run), o = (s.offer || []).filter(function (x) { return x[0] === k; })[0];
    if (!o || !E.offerAt(o, s)[pos]) return;
    try { run = applyMove(['p', k, pos]); } catch (e) { toast(errText(e)); drawDraft(); return; }
    var x = run.roster.filter(function (y) { return y.k === k; })[0];
    state.flash = { pos: x.pos, n: x.n, ovr: x.ovr };
    beep(660, 0.12, 0.04, 'triangle');
    if (run.status !== 'done') { drawDraft(); return; }
    finishRun(run);
    state.flash = null;
    drawFinal(run, true);
    var top = $('.c18-final', screen); if (top && top.scrollIntoView) top.scrollIntoView({ block: 'start' });
  }

  function rosterTable(run) {
    return '<div class="c18-roster-sum">' + run.roster.map(function (x) {
      var p = player(run.season, x.k), at = p && p.p && p.p[x.pos];
      var rank = at && at.rk ? '<span class="c18-rs-rank" title="#' + at.rk + ' of ' + at.of + ' at ' + esc(x.pos) + ' that season"><b>#' + at.rk + '</b><span>of ' + at.of + '</span></span>' : '';
      return '<div class="c18-rs ' + tierClass(x.ovr) + '"><span class="c18-rs-pos">' + esc(x.pos) + '</span>' + (p ? p.av : '') +
        '<span class="c18-rs-who"><strong>' + esc(x.n) + '</strong><em>' + esc(x.t) + '</em></span>' + rank +
        '<button class="c18-ovr sm" type="button" data-act="explain" data-k="' + esc(x.k) + '" data-pos="' + esc(x.pos) + '" data-season="' + esc(run.season) + '"><b>' + x.ovr + '</b><span>OVR</span></button></div>';
    }).join('') + '</div>';
  }
  function shareUrl(run) { return location.origin + location.pathname + '#run=' + run.id; }
  function bestRecord(league) {
    var best = null;
    ((me && me.runs) || []).forEach(function (s) {
      if (s.status !== 'done' || !s.record || leagueOf(s) !== league) return;
      if (!best || s.record.w > best.w || (s.record.w === best.w && s.record.l < best.l)) best = s.record;
    });
    return best;
  }
  function gradeOf(run) { var r = run.record; return run.grade || E.grade(r.w, r.w + r.l); }
  function gradeClass(g) { return 'g-' + g.charAt(0).toLowerCase(); }
  function drawFinal(run, mine) {
    state.shareRun = run;
    var r = run.record, g = gradeOf(run), league = leagueOf(run), best = mine ? bestRecord(league) : null;
    screen.innerHTML = '<div class="c18-final' + (run.perfect ? ' perfect' : '') + '">' +
      '<div class="eyebrow">' + esc(mine ? 'Your season' : run.name + '’s season') + ' &middot; ' + esc(league) + ' &middot; ' + esc(seasonLabel(run.season)) + ' &middot; ' + esc(run.modeLabel) + '</div>' +
      '<div class="c18-result-top">' +
      '<div class="c18-result-box rec"><span>Record</span><b class="c18-record-big">' + dash(r.w, r.l) + '</b>' +
      (run.perfect ? '<em class="c18-perfect">🏆 Perfect season</em>' : run.result && run.result.code === 'eliminated' ? '<em>' + esc(run.result.text) + '</em>' : '') + '</div>' +
      '<div class="c18-result-box grade ' + gradeClass(g) + '"><span>Grade</span><b>' + esc(g) + '</b></div>' +
      (best ? '<div class="c18-result-box"><span>Your best</span><b>' + dash(best.w, best.l) + '</b></div>' : '') +
      '</div>' +
      (run.unique ? '<div class="c18-unique" title="Nobody has finished a run with these players at these spots in this season before">💎 <strong>One of a kind</strong><span>Nobody has drafted this lineup before</span></div>' : '') +
      '<div class="card c18-roster-card"><h3>' + (mine ? 'Your roster' : 'Roster') + ' <span class="muted">Team OVR ' + f1(run.team.ovr) + '</span></h3>' + rosterTable(run) + '</div>' +
      '<div class="c18-row c18-center c18-actions">' +
      (mine ? '<button class="btn btn-primary c18-big" type="button" data-act="new-game">New game</button>'
        : '<button class="btn btn-primary c18-big" type="button" data-go="home">Play the 17&ndash;0 Challenge</button>') +
      '<button class="btn btn-ghost" type="button" data-act="share">Share</button></div>' +
      (mine ? '<p class="muted c18-note c18-center">' + (run.perfect ? 'You drafted the best team the season allows.'
        : '<button class="c18-link" type="button" data-act="settings">Change league or season</button>') + '</p>' : '') +
      (mine ? '<p class="c18-save-note' + (saveState[run.id] === 'saved' ? ' ok' : '') + '" data-save-note="' + esc(run.id) + '">' + saveNoteText(run.id) + '</p>' : '') +
      '</div>';
    if (run.perfect && !state.confettiDone) { state.confettiDone = true; confetti(); }
  }
  function newGame() {
    var last = state.shareRun || state.run || {};
    startRun(leagueOf(last.league ? last : { league: state.league }), last.season || state.season, last.mode || state.mode || C18.default_mode);
  }
  function share(run) {
    var text = E.shareText(run, shareUrl(run));
    modal('<div class="c18-share"><h2 id="c18-modal-title">Share result</h2><pre class="c18-share-text">' + esc(text) + '</pre>' +
      '<div class="c18-row"><button class="btn btn-primary" type="button" data-act="copy-discord">Copy for Discord</button>' +
      '<button class="btn btn-ghost" type="button" data-act="copy-link">Copy link</button>' +
      (navigator.share ? '<button class="btn btn-ghost" type="button" data-act="native-share">Share&hellip;</button>' : '') + '</div>' +
      '<p class="muted c18-note">' + (C18.cloud ? 'The link opens this run for anyone: every draw, pick and game.' : 'No challenge server is set up yet, so the link only works on this device.') + '</p></div>');
  }
  function copy(text, done) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { toast(done); }).catch(function () {
      var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(done); } catch (e) { toast('Couldn’t copy. Select the text and copy it yourself.'); }
      ta.remove();
    });
  }

  function confetti() {
    var c = $('[data-confetti]');
    if (!c || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    c.hidden = false; c.width = innerWidth; c.height = innerHeight;
    var ctx = c.getContext('2d'), colors = ['#f0404f', '#f3f1ec', '#3f6fe6', '#e8b54d', '#45c486'], bits = [];
    for (var i = 0; i < 180; i++) bits.push({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.6, r: 4 + Math.random() * 6, c: colors[i % colors.length], vy: 2 + Math.random() * 3, vx: -1.5 + Math.random() * 3, a: Math.random() * 6, va: -0.2 + Math.random() * 0.4 });
    var t0 = null;
    function f(ts) {
      if (t0 == null) t0 = ts;
      ctx.clearRect(0, 0, c.width, c.height);
      bits.forEach(function (b) { b.x += b.vx; b.y += b.vy; b.a += b.va; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.c; ctx.fillRect(-b.r / 2, -b.r / 4, b.r, b.r / 2); ctx.restore(); });
      if (ts - t0 < 6000) requestAnimationFrame(f); else { c.hidden = true; }
    }
    requestAnimationFrame(f);
    chime(true);
  }

  function drawBoard() {
    var f = state.board;
    if (!f.league) f.league = state.league;
    if (f.league !== state.league) return useLeague(f.league).then(drawBoard, function () { f.league = 'MCFL'; drawBoard(); });
    var leagues = hasMfl() ? '<select data-board-league>' + ['MCFL', 'MFL'].map(function (c) { return '<option' + (f.league === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' : '';
    var seasons = '<option value="">All seasons</option>' + (VIEW.order || []).map(function (id) { return '<option value="' + esc(id) + '"' + (f.season === id ? ' selected' : '') + '>' + esc(seasonLabel(id)) + '</option>'; }).join('');
    var modes = '<option value="">All modes</option>' + modeIds().map(function (id) { return '<option value="' + esc(id) + '"' + (f.mode === id ? ' selected' : '') + '>' + esc(C18.modes[id].label) + '</option>'; }).join('');
    screen.innerHTML = '<div class="section-head"><h1 class="section-title">Leaderboard</h1></div>' +
      '<div class="c18-filters">' + leagues + '<select data-board-season>' + seasons + '</select><select data-board-mode>' + modes + '</select></div>' +
      '<div data-board-body><div class="c18-loading">Loading&hellip;</div></div>' +
      (C18.cloud ? '' : '<p class="muted c18-note">No challenge server is set up yet, so this only shows runs played on this device.</p>');
    api({ action: 'board', league: f.league, season: f.season || '', mode: f.mode || '' }).then(need).then(function (r) {
      var body = $('[data-board-body]', screen); if (!body) return;
      var rows = r.rows.filter(function (s) { return leagueOf(s) === f.league; });
      if (!rows.length) { body.innerHTML = '<div class="card c18-empty"><strong>No runs yet</strong><span>Be the first on the board.</span></div>'; return; }
      body.innerHTML = '<div class="card table-card"><div class="table-scroll"><table class="data-table c18-table c18-board"><thead><tr><th class="l">Rank</th><th class="l">User</th><th>Record</th><th>Grade</th><th>OVR</th><th class="l">Season</th><th class="l">Date</th></tr></thead><tbody>' +
        rows.map(function (s, i) {
          var g = s.grade || E.grade(s.record.w, s.record.w + s.record.l);
          return '<tr class="r' + (i + 1) + ' c18-click" data-run="' + esc(s.id) + '"><td class="l"><span class="rank-num">' + (i + 1) + '</span></td><td class="l strong">' + esc(s.name) + '</td>' +
            '<td class="strong sorted">' + dash(s.record.w, s.record.l) + (s.perfect ? ' 🏆' : '') + (s.unique ? ' <span title="One of a kind: the first run with this lineup">💎</span>' : '') + '</td><td><span class="c18-grade-chip ' + gradeClass(g) + '">' + esc(g) + '</span></td><td>' + f1(s.ovr) + '</td>' +
            '<td class="l">' + esc(seasonLabel(s.season)) + ' &middot; ' + esc(s.modeLabel) + '</td><td class="l muted">' + ago(s.finished) + '</td></tr>';
        }).join('') + '</tbody></table></div></div>' + (r.total > r.rows.length ? '<p class="muted c18-note">Top ' + r.rows.length + ' of ' + r.total + ' runs.</p>' : '');
    }).catch(function (e) { var body = $('[data-board-body]', screen); if (body) body.innerHTML = '<p class="muted">' + esc(errText(e)) + '</p>'; });
  }
  function drawPlayers() {
    var f = state.players;
    if (!f.league) f.league = state.league;
    if (f.league !== state.league) return useLeague(f.league).then(drawPlayers, function () { f.league = 'MCFL'; drawPlayers(); });
    if (!f.season || !VIEW.seasons[f.season]) f.season = DATA.current;
    var season = f.season, pos = f.pos || '';
    var leagues = hasMfl() ? '<select data-players-league>' + ['MCFL', 'MFL'].map(function (c) { return '<option' + (f.league === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' : '';
    var seasons = (VIEW.order || []).map(function (id) { return '<option value="' + esc(id) + '"' + (season === id ? ' selected' : '') + '>' + esc(seasonLabel(id)) + '</option>'; }).join('');
    var poss = '<option value="">All positions</option>' + ['QB', 'WR', 'DEF'].map(function (q) { return '<option' + (pos === q ? ' selected' : '') + '>' + q + '</option>'; }).join('');
    var rows = [];
    VIEW.seasons[season].players.forEach(function (p) {
      var q = pos;
      if (!q) Object.keys(p.p).forEach(function (x) { if (!q || p.p[x].o > p.p[q].o || (p.p[x].o === p.p[q].o && p.p[x].rk < p.p[q].rk)) q = x; });
      if (q && p.p[q]) rows.push({ p: p, pos: q, x: p.p[q] });
    });
    rows.sort(function (a, b) { return b.x.o - a.x.o || a.x.rk / a.x.of - b.x.rk / b.x.of || a.p.n.toLowerCase().localeCompare(b.p.n.toLowerCase()); });
    screen.innerHTML = '<div class="section-head"><h1 class="section-title">Players</h1></div>' +
      '<div class="c18-filters">' + leagues + '<select data-players-season>' + seasons + '</select><select data-players-pos>' + poss + '</select></div>' +
      (rows.length ? '<div class="card table-card"><div class="table-scroll"><table class="data-table c18-table c18-board c18-players"><thead><tr><th class="l">#</th><th class="l">Player</th><th>OVR</th><th>Pos rank</th><th class="l">Team</th><th>GP</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          return '<tr class="r' + (i + 1) + '"><td class="l"><span class="rank-num">' + (i + 1) + '</span></td>' +
            '<td class="l strong"><span class="c18-pl-who">' + r.p.av + esc(r.p.n) + '</span></td>' +
            '<td class="sorted"><button class="c18-ovr c18-ovr-sm ' + tierClass(r.x.o) + '" type="button" data-act="explain" data-season="' + esc(season) + '" data-k="' + esc(r.p.k) + '" data-pos="' + esc(r.pos) + '" title="Why this rating?"><b>' + r.x.o + '</b></button></td>' +
            '<td>#' + r.x.rk + ' ' + esc(r.pos) + ' <span class="muted c18-pl-of">of ' + r.x.of + '</span></td>' +
            '<td class="l"><span class="c18-pl-who">' + teamMark(season, r.p.t, 'sm') + '<span class="c18-pl-team">' + esc(r.p.t) + '</span></span></td>' +
            '<td class="muted">' + r.p.gp + '</td></tr>';
        }).join('') + '</tbody></table></div></div>'
        : '<div class="card c18-empty"><strong>No players that season</strong></div>');
  }
  function drawRuns() {
    if (C18.cloud && !session) { screen.innerHTML = '<div class="card c18-empty"><strong>Sign in to see your runs</strong><button class="btn btn-primary" type="button" data-go="home">Sign in</button></div>'; return; }
    screen.innerHTML = '<div class="section-head"><h1 class="section-title">My runs</h1></div><div data-runs><div class="c18-loading">Loading&hellip;</div></div>';
    function fill() {
      var el = $('[data-runs]', screen); if (!el) return;
      var runs = (me && me.runs) || [];
      if (state.draft) runs = [{ id: state.draft.id, status: 'drafting', league: state.draft.league, season: state.draft.season, modeLabel: modeLabel(state.draft.mode), created: state.draft.t }].concat(runs);
      if (!runs.length) { el.innerHTML = '<div class="card c18-empty"><strong>No runs yet</strong><button class="btn btn-primary" type="button" data-go="home">Start one</button></div>'; return; }
      var n = runs.length;
      el.innerHTML = '<div class="c18-runs">' + runs.map(function (s, i) {
        var num_ = n - i, status;
        if (s.status === 'done') status = s.perfect ? '🏆 Perfect season' : 'Grade ' + esc(s.grade || E.grade(s.record.w, s.record.w + s.record.l));
        else if (s.status === 'abandoned') status = 'Abandoned';
        else status = 'In progress';
        return '<button type="button" class="card c18-run ' + esc(s.status) + '" ' + (s.status === 'done' ? 'data-run="' + esc(s.id) + '"' : s.status === 'abandoned' ? 'disabled' : 'data-act="resume"') + '>' +
          '<span class="c18-run-n">Run #' + num_ + '</span>' +
          '<b>' + (s.record ? dash(s.record.w, s.record.l) : '&mdash;') + '</b>' +
          '<span>' + (s.ovr != null ? f1(s.ovr) + ' OVR' : '') + '</span><strong>' + status + '</strong>' +
          '<em>' + esc(leagueOf(s)) + ' &middot; ' + esc(seasonLabel(s.season)) + ' &middot; ' + esc(s.modeLabel) + ' &middot; ' + ago(s.finished || s.created) + '</em></button>';
      }).join('') + '</div>';
    }
    if (me) fill();
    refreshMe().then(fill).catch(function (e) { if (me) return; var el = $('[data-runs]', screen); if (el) el.innerHTML = '<p class="muted">' + esc(errText(e)) + '</p>'; });
  }
  function drawHow() {
    var cfg = DATA.config, sim = cfg.simulation, rw = cfg.ratings.weights;
    var weights = Object.keys(rw).map(function (pos) {
      return '<div class="c18-how-w"><strong>' + esc(pos) + '</strong><span>' + Object.keys(rw[pos]).map(function (m) { return esc(m.replace(/_/g, ' ')) + ' ' + rw[pos][m] + '%'; }).join(' &middot; ') + '</span></div>';
    }).join('');
    var slotW = Object.keys(cfg.slot_weights).map(function (p) { return esc(p) + ' ' + cfg.slot_weights[p] + '%'; }).join(' &middot; ');
    screen.innerHTML = '<div class="section-head"><h1 class="section-title">How it works</h1></div><div class="c18-how">' +
      '<div class="card"><h2>The team draw</h2><p>Every pick starts with a draw. The logo shuffles through every team from the league and season you picked, each equally likely' +
      (Object.keys((cfg.wheel || {}).team_weights || {}).length ? ' (some teams are weighted to come up more or less often)' : '') +
      '. The draws come from a random seed the server gives each run when it starts. You then take any of its players for any spot you still need. If the team has nobody left who can fill an open spot, it draws again on its own. The same team can come up again; the same player can&rsquo;t.</p></div>' +
      '<div class="card"><h2>Player ratings</h2><p>Every rating comes from the player&rsquo;s real stats that season, compared with everyone else at the same position. In the current season it&rsquo;s straight per-game averages: games played don&rsquo;t matter, so nobody is ahead just for having played more. In past seasons, players with few games are pulled toward the average, so one big game can&rsquo;t make a 99, and anyone under ' + (cfg.ratings.full_games || 4) + ' games has their rating lowered (the fewer games, the more). Tap any OVR to see how it was worked out.</p>' + weights + '</div>' +
      '<div class="card"><h2>Your team</h2><p>Team OVR weights the spots: ' + slotW + '.</p></div>' +
      '<div class="card"><h2>The season</h2><p>' + (sim.regular_season_games || 17) + ' games against the real teams. The closer your roster is to the best one the season allows, the more you win. <strong>17&ndash;0 is only possible if your spots rank, on average, top ' + (sim.perfect_avg_rank || 3) + ' at their positions</strong> (your two WRs count as the 1st and 2nd spots, so the two best WRs are both rank 1). Any further off and you lose at least once. Your grade comes from your record: A+ is 17&ndash;0.</p></div>' +
      '<div class="card"><h2>Fair play</h2><p>Your run plays in your browser so nothing waits on the server, but the draws and games all come from the seed the server handed out. When you finish, the server replays every move from that seed and only then saves the run. A finished run never changes. Starting over gives up the run in progress.</p></div>' +
      '</div>';
  }
  function drawReplay() {
    var id = state.replayId;
    if (state.run && state.run.id === id && state.run.status === 'done') return drawFinal(state.run, true);
    screen.innerHTML = '<div class="c18-loading">Loading the run&hellip;</div>';
    api({ action: 'run', id: id }).then(need).then(function (r) {
      state.replayRun = r.run;
      return useLeague(leagueOf(r.run)).then(function () { drawFinal(r.run, !!(session && r.run.user === session.user.toLowerCase())); });
    }).catch(function (e) { screen.innerHTML = '<div class="card c18-empty"><strong>' + esc(errText(e)) + '</strong><button class="btn btn-primary" type="button" data-go="home">Play the 17&ndash;0 Challenge</button></div>'; });
  }

  function giveUp() {
    saveDraft(null);
    state.run = null; state.busy = false;
    closeModal();
    drawPlay();
    toast('Run given up.');
  }

  function currentRunForView() { return state.view === 'run' ? (state.replayRun && state.replayRun.id === state.replayId ? state.replayRun : state.run) : state.run; }
  document.addEventListener('click', function (e) {
    if (!root.contains(e.target) && !e.target.closest('[data-modal]')) return;
    var t = e.target.closest('[data-go],[data-act],[data-close],[data-mode],[data-league],[data-run],[data-sound]');
    if (!t) { if (e.target === $('[data-modal]')) closeModal(); return; }
    if (t.hasAttribute('data-close')) { closeModal(); return; }
    if (t.hasAttribute('data-sound')) { soundOn = !soundOn; save(SOUND, soundOn); drawSound(); return; }
    if (t.hasAttribute('data-go')) { e.preventDefault(); var v = t.getAttribute('data-go'); if (v === 'home' && state.run && state.run.status === 'done') state.run = null; go(v); return; }
    if (t.hasAttribute('data-league')) { useLeague(t.getAttribute('data-league')).then(drawStart, function (err) { toast(errText(err)); }); return; }
    if (t.hasAttribute('data-mode')) { state.mode = t.getAttribute('data-mode'); $$('.c18-mode', screen).forEach(function (b) { b.classList.toggle('active', b === t); }); return; }
    if (t.hasAttribute('data-run')) { state.replayId = t.getAttribute('data-run'); go('run'); return; }
    var act = t.getAttribute('data-act'), run = currentRunForView();
    switch (act) {
      case 'signout': signOut(); break;
      case 'create': {
        var form = $('[data-form="signin"]', screen), u = form.user.value.trim(), p = form.password.value, msg = $('[data-msg]', form);
        if (!/^[A-Za-z0-9_.]{3,20}$/.test(u)) { msg.textContent = ERRORS.bad_account; break; }
        if (p.length < 6) { msg.textContent = 'Use a password of at least 6 characters.'; break; }
        msg.textContent = 'Creating your account…';
        createAccount(u, p).then(function () { drawAccount(); route(); }).catch(function (err) { msg.textContent = errText(err); });
        break;
      }
      case 'resume':
        resumeDraft().then(function (run) { if (!run) toast('That run can’t be picked up again.'); go('home'); });
        break;
      case 'start': {
        var season = ($('[data-season]', screen) || {}).value || DATA.current;
        t.disabled = true; t.textContent = 'Starting…';
        startRun(state.league, season, state.mode || C18.default_mode);
        break;
      }
      case 'abandon':
        modal('<div class="c18-confirm"><h2 id="c18-modal-title">Give up this run?</h2><p class="muted">You can&rsquo;t come back to it.</p>' +
          '<div class="c18-row"><button class="btn btn-primary" type="button" data-act="abandon-yes">Give up</button><button class="btn btn-ghost" type="button" data-close>Keep playing</button></div>' +
          '<p class="c18-modal-msg" data-modal-msg role="alert"></p></div>');
        break;
      case 'abandon-yes': giveUp(); break;
      case 'spin': doSpin(false); break;
      case 'reroll': doSpin(true); break;
      case 'choose': choose(t.getAttribute('data-k'), t.getAttribute('data-pos')); break;
      case 'explain': explain(t.getAttribute('data-season') || (run && run.season) || DATA.current, t.getAttribute('data-k'), t.getAttribute('data-pos')); break;
      case 'new-game': newGame(); break;
      case 'settings': state.run = null; go('home'); break;
      case 'share': share(state.shareRun); break;
      case 'copy-discord': copy(E.shareText(state.shareRun, shareUrl(state.shareRun)), 'Copied. Paste it in Discord.'); break;
      case 'copy-link': copy(shareUrl(state.shareRun), 'Link copied.'); break;
      case 'native-share': navigator.share({ title: '17–0 Challenge', text: E.shareText(state.shareRun), url: shareUrl(state.shareRun) }).catch(function () {}); break;
      case 'again': state.run = null; go('home'); break;
    }
  });
  root.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.getAttribute('data-form') !== 'signin') return;
    e.preventDefault();
    var msg = $('[data-msg]', form), u = form.user.value.trim();
    if (!/^[A-Za-z0-9_.]{3,20}$/.test(u)) { msg.textContent = ERRORS.bad_account; return; }
    msg.textContent = 'Signing in…';
    signIn(u, form.password.value).then(function () { drawAccount(); route(); }).catch(function (err) { session = null; msg.textContent = errText(err); });
  });
  root.addEventListener('change', function (e) {
    if (e.target.matches('[data-season]')) state.season = e.target.value;
    if (e.target.matches('[data-board-league]')) { state.board.league = e.target.value; state.board.season = null; drawBoard(); }
    if (e.target.matches('[data-board-season]')) { state.board.season = e.target.value; drawBoard(); }
    if (e.target.matches('[data-board-mode]')) { state.board.mode = e.target.value; drawBoard(); }
    if (e.target.matches('[data-players-league]')) { state.players.league = e.target.value; state.players.season = null; drawPlayers(); }
    if (e.target.matches('[data-players-season]')) { state.players.season = e.target.value; drawPlayers(); }
    if (e.target.matches('[data-players-pos]')) { state.players.pos = e.target.value; drawPlayers(); }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('popstate', function () { fromHash(); route(); });

  function start() {
    ['[data-modal]', '[data-toast]', '[data-confetti]'].forEach(function (sel) { var el = $(sel, root); if (el) document.body.appendChild(el); });
    drawSound();
    useLeague('MCFL')
      .then(function () {
        loadLeague('MFL').then(function () {
          if (state.view === 'home' && !state.run && $('[data-act="start"]', screen)) drawStart();
        }, function () {});
        state.mode = C18.default_mode;
        if (C18.cloud) {
          session = load(SESSION);
          if (!session) { var fs = load(FANTASY_SESSION); if (fs && fs.user && fs.hash) session = { user: fs.user, hash: fs.hash }; }
        } else session = { user: 'You', hash: 'local' };
        drawAccount();
        fromHash();
        loadDraft();
        return resumeDraft();
      })
      .then(function () {
        route();
        if (!session) return;
        sendOutbox();
        refreshMe().then(function () {
          drawAccount();
          if (state.view === 'home' && !state.run && $('[data-act="start"]', screen)) drawStart();
        }).catch(function () {});
      })      .catch(function () { screen.innerHTML = '<div class="card c18-empty"><strong>Couldn’t load the players.</strong><span>Reload the page to try again.</span></div>'; });
  }
  start();
})();
