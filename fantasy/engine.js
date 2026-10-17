var FantasyEngine = (function () {
  'use strict';
  var VERSION = 2;
  var MAX_TX = 300, MAX_TRADES = 150, MAX_ACCOUNTS = 1000;
  var ACCOUNT = /^[A-Za-z0-9_.]{3,20}$/;
  var B64 = /^[A-Za-z0-9+\/]+={0,2}$/;
  var COLOR = /^#[0-9a-fA-F]{6}$/;
  var TIMERS = [30, 60, 90, 120, 180];

  var BOT_TEAMS = ['Creeper Crew', 'Nether Knights', 'Diamond Dogs', 'Ender Edge', 'Obsidian Order', 'Blaze Brigade',
    'Ghast Busters', 'Piglin Posse', 'Warden Wall', 'Axolotl Army', 'Iron Golems', 'Slime Time', 'Emerald Empire',
    'Phantom Force', 'Redstone Rockets', 'Sculk Squad', 'Lapis Lions', 'Trident Titans', 'Beacon Blitz', 'Netherite Nine'];
  var BOT_MANAGERS = ['Steve_Bot', 'AlexAI', 'Villager42', 'Herobrine', 'NotchFan', 'MobGrinder', 'Pixel_Pete', 'CobbleCoach',
    'Blocky_Bill', 'DirtDweller', 'OreOracle', 'CraftyCarl'];
  var COLORS = ['#e0404f', '#e8833a', '#e8b54d', '#45c486', '#4fd1e8', '#3f6fe6', '#9b6cf0', '#e85aa8', '#6f7a9c', '#2fb3a0'];

  function fail(code) { var e = new Error(code); e.code = code; throw e; }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5; var t = a;
      t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, r) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function abbrev(name) {
    var w = String(name).replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    var a = w.length > 1 ? w.map(function (x) { return x[0]; }).join('') : (w[0] || 'TM');
    return (a.length < 3 && w[0] ? (a + w[w.length - 1].slice(1)).slice(0, 3) : a.slice(0, 3)).toUpperCase();
  }
  function cleanName(s, max) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max); }

  function context(pool, now) {
    var C = { pool: pool, byKey: {}, SLOTS: [], now: now || function () { return Date.now(); } };
    pool.players.forEach(function (p) { C.byKey[p.k] = p; });
    C.CW = pool.current; C.LAST = pool.last_week; C.RULES = pool.rules; C.REG = pool.rules.reg_weeks;
    ['QB', 'WR', 'FLEX', 'DEF', 'BENCH'].forEach(function (s) {
      var n = +(pool.rules.roster[s] || 0);
      for (var i = 0; i < n; i++) C.SLOTS.push(s);
    });
    C.ROSTER_SIZE = C.SLOTS.length;
    C.STARTS = C.SLOTS.filter(function (s) { return s !== 'BENCH'; });
    C.ranked = pool.players.slice().sort(function (a, b) { return b.tot - a.tot || (a.k < b.k ? -1 : 1); });
    return C;
  }
  function pts(C, k, w) { var p = C.byKey[k], x = p && p.w[String(w)]; return x == null ? 0 : typeof x === 'number' ? x : x[0]; }
  function played(C, k, w) { var p = C.byKey[k]; return !!(p && p.w[String(w)] != null); }
  function game(C, k, w) { var p = C.byKey[k]; return p ? (C.pool.games[p.t] || {})[String(w)] || { state: 'none' } : { state: 'none' }; }
  function weekState(C, w) { return C.pool.weeks[String(w)] || 'upcoming'; }
  function locked(C, k, w) {
    if (w < C.CW) return true;
    if (w > C.CW) return false;
    var g = game(C, k, w);
    return g.state === 'final' || (!!g.kick && C.now() >= Date.parse(g.kick));
  }
  function fits(C, pos, slot) { return slot === 'BENCH' || slot === pos || (slot === 'FLEX' && C.RULES.flex.indexOf(pos) >= 0); }

  function team(L, tid) { for (var i = 0; i < L.teams.length; i++) if (L.teams[i].id === tid) return L.teams[i]; return null; }
  function teamOf(L, owner) { for (var i = 0; i < L.teams.length; i++) if (L.teams[i].owner === owner) return L.teams[i]; return null; }
  function humans(L) { return L.teams.filter(function (t) { return t.owner; }); }
  function ownerOf(L, k) {
    for (var i = 0; i < L.teams.length; i++) {
      if ((L.roster[L.teams[i].id] || []).some(function (r) { return r.k === k; })) return L.teams[i].id;
    }
    return null;
  }
  function onWaivers(L, k) { return !!L.waivers[k] && !ownerOf(L, k); }
  function log(L, entry, C) {
    entry.time = C.now();
    if (entry.week == null) entry.week = C.CW;
    L.tx.push(entry);
    if (L.tx.length > MAX_TX) L.tx = L.tx.slice(-MAX_TX);
  }

  function createLeague(C, o) {
    var L = {
      v: VERSION, id: o.id, name: o.name || 'Fantasy League', created: new Date(C.now()).toISOString(), commish: o.owner,
      status: 'open', size: Math.max(2, Math.min(12, o.size || C.RULES.size || 6)), seed: Math.floor((o.random || Math.random)() * 2e9),
      teams: [], draft: { timer: 60, startAt: null, order: [], picks: [], turnStart: null, deadline: null },
      roster: {}, weeks: {}, schedule: {}, waivers: {}, claims: [], tx: [], trades: [], tradeSeq: 0,
      processed: 0, joinedWeek: null, rev: 0, pool: o.pool || ''
    };
    return L;
  }
  function canJoin(L) {
    return L.status === 'open' ? humans(L).length < L.size : L.teams.some(function (t) { return !t.owner; });
  }
  function join(L, C, who) {
    var have = teamOf(L, who.owner);
    if (have) return have.id;
    var name = cleanName(who.team, 24);
    if (name.length < 2) fail('bad_team');
    var color = COLOR.test(who.color || '') ? who.color : COLORS[L.teams.length % COLORS.length];
    var clash = function (t) { return t.name.toLowerCase() === name.toLowerCase(); };
    if (L.status === 'open') {
      if (humans(L).length >= L.size) fail('league_full');
      if (L.teams.some(clash)) fail('team_taken');
      var id = 't' + (L.teams.length + 1);
      L.teams.push({ id: id, name: name, abbrev: abbrev(name), manager: who.manager, color: color, owner: who.owner, auto: false, queue: [] });
      L.roster[id] = [];
      log(L, { t: 'join', team: id }, C);
      return id;
    }
    var bot = L.teams.filter(function (t) { return !t.owner; })[0];
    if (!bot) fail('league_full');
    if (L.teams.some(function (t) { return t !== bot && clash(t); })) fail('team_taken');
    var was = bot.name;
    bot.owner = who.owner; bot.manager = who.manager; bot.name = name; bot.abbrev = abbrev(name); bot.color = color; bot.auto = false; bot.queue = [];
    log(L, { t: 'join', team: bot.id, was: was }, C);
    return bot.id;
  }
  function leave(L, C, tid) {
    var t = team(L, tid); if (!t) return;
    var r = rng(L.seed + L.tx.length);
    t.owner = null; t.manager = BOT_MANAGERS[Math.floor(r() * BOT_MANAGERS.length)]; t.auto = true; t.queue = [];
    L.trades.forEach(function (x) { if (x.status === 'pending' && (x.from === tid || x.to === tid)) x.status = 'Cancelled'; });
    L.claims = L.claims.filter(function (c) { return c.team !== tid; });
    if (L.status === 'open') {
      L.teams = L.teams.filter(function (x) { return x.id !== tid; });
      delete L.roster[tid];
    } else log(L, { t: 'leave', team: tid }, C);
    if (L.commish && !teamOf(L, L.commish)) L.commish = humans(L).length ? humans(L)[0].owner : null;
  }

  function openSlot(C, ros, pos) {
    var used = {}, counts = {};
    ros.forEach(function (r) { used[r.s] = (used[r.s] || 0) + 1; });
    C.SLOTS.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    var order = ['QB', 'WR', 'FLEX', 'DEF', 'BENCH'];
    for (var i = 0; i < order.length; i++) {
      var s = order[i];
      if ((used[s] || 0) < (counts[s] || 0) && fits(C, pos, s)) return s;
    }
    return null;
  }

  function startDraft(L, C, at) {
    if (L.status !== 'open') fail('started');
    var r = rng(L.seed);
    var used = L.teams.map(function (t) { return t.name.toLowerCase(); });
    var names = shuffle(BOT_TEAMS.filter(function (n) { return used.indexOf(n.toLowerCase()) < 0; }), r);
    var mgrs = shuffle(BOT_MANAGERS.slice(), r);
    var colors = shuffle(COLORS.slice(), r);
    for (var i = L.teams.length; i < L.size; i++) {
      var id = 't' + (i + 1), n = names.shift() || ('Bot Team ' + (i + 1));
      L.teams.push({ id: id, name: n, abbrev: abbrev(n), manager: mgrs[i % mgrs.length], color: colors[i % colors.length], owner: null, auto: true, queue: [] });
      L.roster[id] = [];
    }
    L.status = 'drafting';
    L.draft.order = shuffle(L.teams.map(function (t) { return t.id; }), r);
    L.draft.picks = [];
    L.draft.turnStart = at;
    L.draft.deadline = at + L.draft.timer * 1000;
    log(L, { t: 'draft-start' }, C);
  }
  function totalPicks(L, C) { return L.draft.order.length * C.ROSTER_SIZE; }
  function onClock(L) {
    var n = L.draft.order.length, i = L.draft.picks.length;
    if (!n) return null;
    var round = Math.floor(i / n), idx = i % n;
    return round % 2 ? L.draft.order[n - 1 - idx] : L.draft.order[idx];
  }
  function drafted(L) { var d = {}; L.draft.picks.forEach(function (p) { if (p.k) d[p.k] = true; }); return d; }
  function choose(L, C, tid, bot) {
    var taken = drafted(L), ros = L.roster[tid], t = team(L, tid);
    var avail = C.ranked.filter(function (p) { return !taken[p.k] && openSlot(C, ros, p.pos); });
    if (!avail.length) return null;
    var queued = (t.queue || []).filter(function (k) { return C.byKey[k] && !taken[k] && openSlot(C, ros, C.byKey[k].pos); });
    if (queued.length && !bot) return queued[0];
    var needs = avail.filter(function (p) { return openSlot(C, ros, p.pos) !== 'BENCH'; });
    var choices = needs.length ? needs : avail;
    var r = rng(L.seed + L.draft.picks.length * 31);
    return choices[bot ? Math.min(choices.length - 1, Math.floor(r() * r() * 3)) : 0].k;
  }
  function makePick(L, C, tid, k, at, auto) {
    var n = L.draft.picks.length, per = L.draft.order.length;
    var slot = k ? openSlot(C, L.roster[tid], C.byKey[k].pos) : null;
    if (k && !slot) fail('no_room');
    if (k) {
      L.roster[tid].push({ k: k, s: slot });
      var t = team(L, tid);
      t.queue = (t.queue || []).filter(function (x) { return x !== k; });
      L.teams.forEach(function (x) { if (x.queue) x.queue = x.queue.filter(function (q) { return q !== k; }); });
    }
    L.draft.picks.push({ round: Math.floor(n / per) + 1, pick: n + 1, team: tid, k: k, auto: !!auto, time: at });
    L.draft.turnStart = at;
    L.draft.deadline = at + L.draft.timer * 1000;
    if (L.draft.picks.length >= totalPicks(L, C)) finishDraft(L, C);
  }
  function draftPick(L, C, tid, k) {
    if (L.status !== 'drafting') fail('not_drafting');
    if (onClock(L) !== tid) fail('not_your_turn');
    if (!C.byKey[k]) fail('no_player');
    if (drafted(L)[k]) fail('taken');
    if (!openSlot(C, L.roster[tid], C.byKey[k].pos)) fail('no_room');
    makePick(L, C, tid, k, C.now(), false);
  }
  function draftTick(L, C) {
    var changed = false, guard = 0;
    if (L.status === 'open' && L.draft.startAt && C.now() >= L.draft.startAt && humans(L).length) {
      startDraft(L, C, L.draft.startAt);
      changed = true;
    }
    while (L.status === 'drafting' && guard++ < 2000) {
      var tid = onClock(L), t = team(L, tid), d = L.draft;
      if (!t.owner || t.auto) {
        makePick(L, C, tid, choose(L, C, tid, !t.owner), d.turnStart, true);
      } else if (C.now() >= d.deadline) {
        makePick(L, C, tid, choose(L, C, tid, false), d.deadline, true);
        t.auto = true;
        t.missed = true;
      } else break;
      changed = true;
    }
    return changed;
  }
  function finishDraft(L, C) {
    L.status = 'active';
    L.joinedWeek = C.CW;
    L.processed = C.CW;
    var ids = L.teams.map(function (t) { return t.id; });
    shuffle(ids, rng(L.seed + 7));
    if (ids.length % 2) ids.push(null);
    var n = ids.length;
    L.schedule = {};
    for (var w = 1; w <= C.REG; w++) {
      var k = (w - 1) % (n - 1);
      var rot = [ids[0]].concat(ids.slice(1).slice(n - 1 - k), ids.slice(1).slice(0, n - 1 - k));
      var games = [];
      for (var g = 0; g < n / 2; g++) {
        var a = rot[g], b = rot[n - 1 - g];
        if (a && b) games.push(w % 2 ? [a, b] : [b, a]);
      }
      L.schedule[w] = games;
    }
    L.teams.forEach(function (t) { t.auto = false; t.queue = []; delete t.missed; if (!t.owner) bestLineup(L, C, t.id, C.CW); });
    for (var pw = 1; pw <= C.CW; pw++) snapshot(L, pw);
    log(L, { t: 'draft' }, C);
  }

  function snapshot(L, w) {
    L.weeks[w] = L.weeks[w] || {};
    L.teams.forEach(function (t) {
      if (!L.weeks[w][t.id]) L.weeks[w][t.id] = L.roster[t.id].map(function (r) { return { k: r.k, s: r.s }; });
    });
  }
  function lineup(L, tid, w) { return (L.weeks[w] && L.weeks[w][tid]) || L.roster[tid] || []; }
  function teamScore(L, C, tid, w) {
    return lineup(L, tid, w).reduce(function (sum, r) { return sum + (r.s !== 'BENCH' ? pts(C, r.k, w) : 0); }, 0);
  }
  function advance(L, C) {
    if (L.status !== 'active') return false;
    var changed = false;
    L.teams.forEach(function (t) {
      var before = L.roster[t.id].length;
      L.roster[t.id] = L.roster[t.id].filter(function (r) { return C.byKey[r.k]; });
      if (L.roster[t.id].length !== before) changed = true;
    });
    while (L.processed < C.CW) {
      var w = ++L.processed;
      changed = true;
      processClaims(L, C, w);
      L.teams.forEach(function (t) { if (!t.owner) botWeek(L, C, t, w); });
      snapshot(L, w);
    }
    if (!L.weeks[C.CW] || L.teams.some(function (t) { return !L.weeks[C.CW][t.id]; })) { snapshot(L, C.CW); changed = true; }
    return changed;
  }
  function tick(L, C) { var z = fitRosters(L, C); var a = draftTick(L, C); var b = advance(L, C); return z || a || b; }

  function fitRosters(L, C) {
    if (C.pool.players.length < 20) return false;
    var changed = false, counts = {};
    C.SLOTS.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    Object.keys(L.roster || {}).forEach(function (tid) {
      var used = {};
      L.roster[tid] = L.roster[tid].filter(function (r) {
        if (C.byKey[r.k]) return true;
        changed = true;
        return false;
      });
      L.roster[tid].forEach(function (r) {
        var ok = r.s === 'BENCH' || (fits(C, C.byKey[r.k].pos, r.s) && (used[r.s] || 0) < (counts[r.s] || 0));
        if (!ok) { r.s = 'BENCH'; changed = true; }
        used[r.s] = (used[r.s] || 0) + 1;
      });
    });
    if (changed && L.status === 'active') Object.keys(L.roster).forEach(function (tid) {
      var t = team(L, tid);
      if (t && !t.owner) { botFill(L, C, t, C.CW); bestLineup(L, C, tid, C.CW); }
    });
    return changed;
  }

  function processClaims(L, C, w) {
    var order = standings(L, C).map(function (r) { return r.id; }).reverse();
    var claims = L.claims.slice();
    L.claims = [];
    order.forEach(function (tid) {
      claims.filter(function (c) { return c.team === tid; }).forEach(function (c) {
        if (!C.byKey[c.add]) return;
        if (ownerOf(L, c.add)) { log(L, { t: 'waiver-lost', team: tid, k: c.add, week: w }, C); return; }
        if (c.drop && !L.roster[tid].some(function (r) { return r.k === c.drop; })) return;
        if (c.drop) removePlayer(L, C, tid, c.drop, w, true);
        if (L.roster[tid].length >= C.ROSTER_SIZE) return;
        addPlayer(L, C, tid, c.add, w);
        log(L, { t: 'waiver', team: tid, k: c.add, drop: c.drop || null, week: w }, C);
      });
    });
    Object.keys(L.waivers).forEach(function (k) { if (L.waivers[k] <= w) delete L.waivers[k]; });
  }
  function freeAgents(L, C) { return C.pool.players.filter(function (p) { return !ownerOf(L, p.k); }); }
  function botFill(L, C, t, w) {
    var counts = {};
    C.SLOTS.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    while (L.roster[t.id].length < C.ROSTER_SIZE) {
      var ros = L.roster[t.id], have = {};
      ros.forEach(function (x) { var pos = C.byKey[x.k].pos; have[pos] = (have[pos] || 0) + 1; });
      var fas = freeAgents(L, C).filter(function (p) { return !L.waivers[p.k]; }).sort(function (a, b) { return b.avg - a.avg; });
      var need = ['DEF', 'QB', 'WR'].filter(function (pos) { return (have[pos] || 0) < (counts[pos] || 0); })[0];
      var fa = (need ? fas.filter(function (p) { return p.pos === need; })[0] : null) || fas[0];
      if (!fa) break;
      addPlayer(L, C, t.id, fa.k, w);
      log(L, { t: 'add', team: t.id, k: fa.k, drop: null, week: w }, C);
    }
  }
  function botWeek(L, C, t, w) {
    botFill(L, C, t, w);
    var r = rng(L.seed + w * 101 + (parseInt(t.id.slice(1), 10) || 0) * 7);
    if (r() < 0.6) {
      var fa = freeAgents(L, C).filter(function (p) { return !L.waivers[p.k]; }).sort(function (a, b) { return b.avg - a.avg; })[0];
      var bench = L.roster[t.id].filter(function (x) { return x.s === 'BENCH'; })
        .sort(function (a, b) { return C.byKey[a.k].avg - C.byKey[b.k].avg; })[0];
      if (fa && bench && fa.avg > C.byKey[bench.k].avg + 1) {
        removePlayer(L, C, t.id, bench.k, w, true);
        addPlayer(L, C, t.id, fa.k, w);
        log(L, { t: 'add', team: t.id, k: fa.k, drop: bench.k, week: w }, C);
      }
    }
    bestLineup(L, C, t.id);
  }
  function bestLineup(L, C, tid, w) {
    var ros = L.roster[tid];
    var free = ros.filter(function (r) { return w === undefined || !locked(C, r.k, w); });
    var fixed = ros.filter(function (r) { return free.indexOf(r) < 0; });
    var open = C.SLOTS.slice();
    fixed.forEach(function (r) { var i = open.indexOf(r.s); if (i >= 0) open.splice(i, 1); });
    var pool = free.slice().sort(function (a, b) { return C.byKey[b.k].avg - C.byKey[a.k].avg; });
    pool.forEach(function (r) { r.s = null; });
    ['QB', 'WR', 'FLEX', 'DEF'].forEach(function (s) {
      open.filter(function (x) { return x === s; }).forEach(function () {
        var p = pool.filter(function (r) { return !r.s && fits(C, C.byKey[r.k].pos, s); })[0];
        if (p) { p.s = s; open.splice(open.indexOf(s), 1); }
      });
    });
    pool.forEach(function (r) { if (!r.s) r.s = 'BENCH'; });
    syncWeek(L, C, tid);
  }
  function syncWeek(L, C, tid) {
    var w = C.CW, wk = L.weeks[w] && L.weeks[w][tid];
    if (!wk) return;
    var keep = wk.filter(function (r) { return locked(C, r.k, w) && !L.roster[tid].some(function (x) { return x.k === r.k; }); });
    L.weeks[w][tid] = L.roster[tid].map(function (r) {
      var was = wk.filter(function (x) { return x.k === r.k; })[0];
      return { k: r.k, s: was && locked(C, r.k, w) ? was.s : r.s };
    }).concat(keep);
  }
  function addPlayer(L, C, tid, k, w) {
    var p = C.byKey[k], slot = 'BENCH', used = {}, counts = {};
    L.roster[tid].forEach(function (r) { used[r.s] = (used[r.s] || 0) + 1; });
    C.SLOTS.forEach(function (s) { counts[s] = (counts[s] || 0) + 1; });
    ['QB', 'WR', 'FLEX', 'DEF'].some(function (s) {
      if ((used[s] || 0) < (counts[s] || 0) && fits(C, p.pos, s) && !locked(C, k, w)) { slot = s; return true; }
      return false;
    });
    L.roster[tid].push({ k: k, s: slot });
    if (w === C.CW && L.weeks[w] && L.weeks[w][tid]) L.weeks[w][tid].push({ k: k, s: locked(C, k, w) ? 'BENCH' : slot });
    delete L.waivers[k];
  }
  function removePlayer(L, C, tid, k, w, toWaivers) {
    L.roster[tid] = L.roster[tid].filter(function (r) { return r.k !== k; });
    if (w === C.CW && L.weeks[w] && L.weeks[w][tid] && !locked(C, k, w)) {
      L.weeks[w][tid] = L.weeks[w][tid].filter(function (r) { return r.k !== k; });
    }
    if (toWaivers) L.waivers[k] = w + 1;
    L.claims = L.claims.filter(function (c) { return !(c.team === tid && c.drop === k); });
  }

  function matchup(L, C, w, a, b, kind, seeds) {
    var st = weekState(C, w);
    var sa = a ? teamScore(L, C, a, w) : 0, sb = b ? teamScore(L, C, b, w) : 0;
    var winner = null;
    if (st === 'final' && a && b) winner = sa > sb ? a : sb > sa ? b : 'tie';
    return { week: w, a: a, b: b, kind: kind, state: st, sa: sa, sb: sb, winner: winner, seeds: seeds };
  }
  function results(L, C) {
    var out = [];
    Object.keys(L.schedule).forEach(function (w) {
      w = +w;
      L.schedule[w].forEach(function (m) { out.push(matchup(L, C, w, m[0], m[1], 'regular')); });
    });
    return out;
  }
  function regDone(C) { for (var w = 1; w <= C.REG; w++) if (weekState(C, w) !== 'final') return false; return true; }
  function standings(L, C) {
    var rec = {};
    L.teams.forEach(function (t) { rec[t.id] = { id: t.id, w: 0, l: 0, t: 0, pf: 0, pa: 0, res: [] }; });
    results(L, C).forEach(function (m) {
      if (m.state !== 'final') return;
      [[m.a, m.sa, m.sb], [m.b, m.sb, m.sa]].forEach(function (x) {
        var r = rec[x[0]]; if (!r) return;
        r.pf += x[1]; r.pa += x[2];
        var o = m.winner === 'tie' ? 'T' : m.winner === x[0] ? 'W' : 'L';
        r[o.toLowerCase()]++; r.res.push(o);
      });
    });
    var rows = L.teams.map(function (t) {
      var r = rec[t.id], gp = r.w + r.l + r.t, s = '';
      if (r.res.length) { var last = r.res[r.res.length - 1], n = 0; for (var i = r.res.length - 1; i >= 0 && r.res[i] === last; i--) n++; s = last + n; }
      r.gp = gp; r.pct = gp ? (r.w + r.t / 2) / gp : 0; r.streak = s;
      r.record = r.w + '-' + r.l + (r.t ? '-' + r.t : '');
      return r;
    });
    rows.sort(function (a, b) { return b.pct - a.pct || b.pf - a.pf || a.pa - b.pa || (a.id < b.id ? -1 : 1); });
    var done = regDone(C);
    rows.forEach(function (r, i) {
      r.rank = i + 1; r.waiver = rows.length - i;
      r.playoff = done ? (i < C.RULES.playoff_teams ? 'Clinched' : 'Eliminated') : (i < C.RULES.playoff_teams && r.gp ? 'In position' : '');
    });
    return rows;
  }
  function playoffs(L, C) {
    var n = C.RULES.playoff_teams, rows = standings(L, C), REG = C.REG;
    var seeds = rows.slice(0, n).map(function (r) { return r.id; });
    var done = regDone(C);
    if (n >= 4) {
      var semis = [matchup(L, C, REG + 1, seeds[0], seeds[3], 'semifinal', [1, 4]), matchup(L, C, REG + 1, seeds[1], seeds[2], 'semifinal', [2, 3])];
      var fin = { week: REG + 2, a: null, b: null, kind: 'final', state: weekState(C, REG + 2), seeds: [null, null] };
      if (done) {
        var wa = semis[0].winner, wb = semis[1].winner;
        if (wa === 'tie') wa = semis[0].a;
        if (wb === 'tie') wb = semis[1].a;
        if (wa && wb) fin = matchup(L, C, REG + 2, wa, wb, 'final', [seeds.indexOf(wa) + 1, seeds.indexOf(wb) + 1]);
      }
      return { done: done, rounds: [{ name: 'Semifinals', week: REG + 1, games: semis }, { name: 'Championship', week: REG + 2, games: [fin] }] };
    }
    return { done: done, rounds: [{ name: 'Championship', week: REG + 1, games: [matchup(L, C, REG + 1, seeds[0], seeds[1], 'final', [1, 2])] }] };
  }
  function champion(L, C) {
    var po = playoffs(L, C); if (!po.done) return null;
    var fin = po.rounds[po.rounds.length - 1].games[0];
    return fin && fin.winner ? (fin.winner === 'tie' ? fin.a : fin.winner) : null;
  }
  function allMatchups(L, C) {
    var list = results(L, C);
    if (regDone(C)) playoffs(L, C).rounds.forEach(function (r) { r.games.forEach(function (g) { if (g.a && g.b) list.push(g); }); });
    return list;
  }
  function teamMatchup(L, C, w, tid) {
    return allMatchups(L, C).filter(function (m) { return m.week === w && (m.a === tid || m.b === tid); })[0] || null;
  }

  function lineupValue(C, keys) {
    var pool = keys.map(function (k) { return C.byKey[k]; }).filter(Boolean).sort(function (a, b) { return b.avg - a.avg; });
    var used = {}, total = 0;
    C.STARTS.forEach(function (s) {
      var p = pool.filter(function (x) { return !used[x.k] && fits(C, x.pos, s); })[0];
      if (p) { used[p.k] = true; total += p.avg; } else total -= 12;
    });
    pool.forEach(function (p) { if (!used[p.k]) total += p.avg * 0.25; });
    return total;
  }
  function stillValid(L, tr) {
    return tr.give.every(function (k) { return ownerOf(L, k) === tr.from; }) && tr.get.every(function (k) { return ownerOf(L, k) === tr.to; });
  }
  function executeTrade(L, C, tr) {
    var w = C.CW;
    tr.give.forEach(function (k) { removePlayer(L, C, tr.from, k, w, false); addPlayer(L, C, tr.to, k, w); });
    tr.get.forEach(function (k) { removePlayer(L, C, tr.to, k, w, false); addPlayer(L, C, tr.from, k, w); });
    [tr.from, tr.to].forEach(function (tid) {
      var t = team(L, tid);
      while (!t.owner && L.roster[tid].length > C.ROSTER_SIZE) {
        var worst = L.roster[tid].filter(function (x) { return x.s === 'BENCH'; }).sort(function (a, b) { return C.byKey[a.k].avg - C.byKey[b.k].avg; })[0] || L.roster[tid][0];
        removePlayer(L, C, tid, worst.k, w, true);
        log(L, { t: 'drop', team: tid, k: worst.k }, C);
      }
      if (!t.owner) bestLineup(L, C, tid, w);
    });
    tr.status = 'Accepted';
    tr.done = C.now();
    log(L, { t: 'trade', team: tr.from, to: tr.to, give: tr.give, get: tr.get }, C);
    L.trades.forEach(function (x) { if (x.status === 'pending' && !stillValid(L, x)) { x.status = 'Failed'; x.why = 'Players have moved'; } });
  }
  function proposeTrade(L, C, from, a) {
    var to = String(a.to || ''), o = team(L, to);
    if (!o || to === from) fail('bad_trade');
    var give = uniq(a.give), get = uniq(a.get);
    if (!give.length && !get.length) fail('bad_trade');
    if (give.length > C.ROSTER_SIZE || get.length > C.ROSTER_SIZE) fail('bad_trade');
    if (!give.every(function (k) { return ownerOf(L, k) === from; }) || !get.every(function (k) { return ownerOf(L, k) === to; })) fail('players_moved');
    if (L.roster[from].length - give.length + get.length > C.ROSTER_SIZE) fail('roster_full');
    var tr = { id: 'tr' + (++L.tradeSeq), from: from, to: to, give: give, get: get, week: C.CW, time: C.now(), status: 'pending', note: cleanName(a.note, 140) };
    L.trades.push(tr);
    if (L.trades.length > MAX_TRADES) L.trades = L.trades.slice(-MAX_TRADES);
    if (!o.owner) {
      var theirs = L.roster[to].map(function (r) { return r.k; });
      var after = theirs.filter(function (k) { return get.indexOf(k) < 0; }).concat(give);
      var gain = lineupValue(C, after) - lineupValue(C, theirs);
      var r = rng(L.seed + L.tradeSeq * 13 + give.length * 7)();
      var accept = gain > 0.5 + r * 1.5 && after.length <= C.ROSTER_SIZE + 1;
      if (accept) { executeTrade(L, C, tr); return o.manager + ' accepted! The players are on your roster.'; }
      tr.status = 'Rejected';
      tr.why = after.length > C.ROSTER_SIZE + 1 ? 'Their roster would be too big' : gain > -1 ? 'Not quite enough for them' : 'They’d be giving up too much';
      return o.manager + ' said no. ' + tr.why + '.';
    }
    return 'Offer sent to ' + o.manager + '.';
  }
  function findTrade(L, id) { return L.trades.filter(function (t) { return t.id === id; })[0] || fail('no_trade'); }
  function respondTrade(L, C, tid, a) {
    var tr = findTrade(L, a.id);
    if (tr.to !== tid || tr.status !== 'pending') fail('no_trade');
    if (!a.accept) { tr.status = 'Rejected'; tr.done = C.now(); log(L, { t: 'trade-no', team: tr.to, to: tr.from }, C); return 'Trade declined.'; }
    if (!stillValid(L, tr)) { tr.status = 'Failed'; tr.why = 'Players have moved'; fail('players_moved'); }
    if (L.roster[tr.to].length - tr.get.length + tr.give.length > C.ROSTER_SIZE) fail('roster_full');
    if (L.roster[tr.from].length - tr.give.length + tr.get.length > C.ROSTER_SIZE) { tr.status = 'Failed'; tr.why = 'Their roster is full'; fail('their_roster_full'); }
    executeTrade(L, C, tr);
    return 'Trade accepted. The players are on your roster.';
  }
  function cancelTrade(L, C, tid, a) {
    var tr = findTrade(L, a.id);
    if (tr.from !== tid || tr.status !== 'pending') fail('no_trade');
    tr.status = 'Cancelled'; tr.done = C.now();
    return 'Offer withdrawn.';
  }
  function uniq(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (k) { k = String(k); if (out.indexOf(k) < 0) out.push(k); });
    return out;
  }

  function canSwap(L, C, tid, a, b) {
    var pa = C.byKey[a.k];
    if (!pa || !fits(C, pa.pos, b.s)) return false;
    if (locked(C, a.k, C.CW)) return false;
    if (b.k) {
      if (!C.byKey[b.k] || locked(C, b.k, C.CW)) return false;
      if (!fits(C, C.byKey[b.k].pos, a.s)) return false;
    } else if (b.s !== 'BENCH') {
      var have = L.roster[tid].filter(function (r) { return r.s === b.s; }).length;
      var room = C.SLOTS.filter(function (s) { return s === b.s; }).length;
      if (have >= room) return false;
    }
    return a.s !== b.s;
  }

  var OPS = {
    rename: function (L, C, tid, a) {
      var t = team(L, tid), name = cleanName(a.name, 24);
      if (name.length < 2) fail('bad_team');
      if (L.teams.some(function (x) { return x !== t && x.name.toLowerCase() === name.toLowerCase(); })) fail('team_taken');
      t.name = name; t.abbrev = abbrev(name);
      var mgr = cleanName(a.manager, 20); if (mgr) t.manager = mgr;
      if (COLOR.test(a.color || '')) t.color = a.color;
      return 'Saved.';
    },
    swap: function (L, C, tid, a) {
      active(L);
      var r = L.roster[tid].filter(function (x) { return x.k === a.k; })[0];
      if (!r) fail('not_yours');
      var other = a['with'] ? L.roster[tid].filter(function (x) { return x.k === a['with']; })[0] : null;
      if (a['with'] && (!other || other.s !== a.to)) fail('lineup_changed');
      if (!canSwap(L, C, tid, { k: r.k, s: r.s }, { k: other ? other.k : null, s: a.to })) fail('cant_move');
      var from = r.s;
      r.s = a.to;
      if (other) other.s = from;
      syncWeek(L, C, tid);
      return C.byKey[r.k].n + ' moved to ' + (a.to === 'BENCH' ? 'the bench' : a.to === 'DEF' ? 'D/ST' : a.to) + '.';
    },
    autoset: function (L, C, tid) { active(L); bestLineup(L, C, tid, C.CW); return 'Best lineup set by season average.'; },
    add: function (L, C, tid, a) {
      active(L);
      var k = a.k, drop = a.drop || null;
      if (!C.byKey[k]) fail('no_player');
      if (ownerOf(L, k)) fail('taken');
      if (L.waivers[k]) fail('on_waivers');
      if (drop && ownerOf(L, drop) !== tid) fail('not_yours');
      if (!drop && L.roster[tid].length >= C.ROSTER_SIZE) fail('roster_full');
      if (drop) removePlayer(L, C, tid, drop, C.CW, true);
      addPlayer(L, C, tid, k, C.CW);
      log(L, { t: 'add', team: tid, k: k, drop: drop }, C);
      return C.byKey[k].n + ' added' + (drop ? ', ' + C.byKey[drop].n + ' dropped.' : '.');
    },
    drop: function (L, C, tid, a) {
      active(L);
      if (ownerOf(L, a.k) !== tid) fail('not_yours');
      removePlayer(L, C, tid, a.k, C.CW, true);
      log(L, { t: 'drop', team: tid, k: a.k }, C);
      return C.byKey[a.k].n + ' dropped.';
    },
    claim: function (L, C, tid, a) {
      active(L);
      if (!C.byKey[a.k] || ownerOf(L, a.k)) fail('taken');
      if (!L.waivers[a.k]) fail('not_on_waivers');
      if (a.drop && ownerOf(L, a.drop) !== tid) fail('not_yours');
      if (!a.drop && L.roster[tid].length >= C.ROSTER_SIZE) fail('roster_full');
      L.claims = L.claims.filter(function (c) { return !(c.team === tid && c.add === a.k); });
      L.claims.push({ team: tid, add: a.k, drop: a.drop || null, week: C.CW, time: C.now() });
      return 'Claim submitted for ' + C.byKey[a.k].n + '.';
    },
    'cancel-claim': function (L, C, tid, a) {
      L.claims = L.claims.filter(function (c) { return !(c.team === tid && c.add === a.k); });
      return 'Claim cancelled.';
    },
    trade: function (L, C, tid, a) { active(L); return proposeTrade(L, C, tid, a); },
    'trade-respond': function (L, C, tid, a) { active(L); return respondTrade(L, C, tid, a); },
    'trade-cancel': function (L, C, tid, a) { return cancelTrade(L, C, tid, a); },
    'draft-pick': function (L, C, tid, a) { draftPick(L, C, tid, a.k); var t = team(L, tid); t.auto = false; delete t.missed; return C.byKey[a.k].n + ' drafted.'; },
    'draft-auto': function (L, C, tid, a) {
      if (L.status === 'active') fail('not_drafting');
      var t = team(L, tid); t.auto = !!a.on; delete t.missed;
      return a.on ? 'Auto-pick is on: your picks are made for you.' : 'Auto-pick is off.';
    },
    'draft-queue': function (L, C, tid, a) {
      if (L.status === 'active') fail('not_drafting');
      var taken = drafted(L);
      team(L, tid).queue = uniq(a.queue).filter(function (k) { return C.byKey[k] && !taken[k]; }).slice(0, 30);
      return 'Queue saved.';
    },
    'draft-settings': function (L, C, tid, a) {
      commish(L, tid);
      if (L.status !== 'open') fail('started');
      if (a.timer != null) { if (TIMERS.indexOf(+a.timer) < 0) fail('bad_request'); L.draft.timer = +a.timer; }
      if (a.startAt !== undefined) {
        if (a.startAt === null) L.draft.startAt = null;
        else { var at = +a.startAt; if (!(at > C.now() - 60000)) fail('bad_time'); L.draft.startAt = at; }
      }
      if (a.size != null) {
        var n = +a.size;
        if (!(n >= 2 && n <= 12) || n < humans(L).length) fail('bad_size');
        L.size = n;
      }
      return 'Draft settings saved.';
    },
    'draft-autodraft': function (L, C, tid) {
      commish(L, tid);
      if (L.status === 'active') fail('not_drafting');
      if (L.status === 'open') startDraft(L, C, C.now());
      L.teams.forEach(function (t) { t.auto = true; });
      draftTick(L, C);
      return 'The whole draft was done automatically.';
    },
    'draft-start': function (L, C, tid) {
      commish(L, tid);
      startDraft(L, C, C.now());
      draftTick(L, C);
      return 'The draft has started!';
    }
  };
  function active(L) { if (L.status !== 'active') fail('not_active'); }
  function commish(L, tid) { var t = team(L, tid); if (!t || t.owner !== L.commish) fail('not_commish'); }

  function apply(L, C, tid, op, args) {
    if (!OPS.hasOwnProperty(op)) fail('bad_request');
    if (!team(L, tid)) fail('no_team');
    return OPS[op](L, C, tid, args || {});
  }

  var MAX_LEAGUES = 300, MAX_MY_LEAGUES = 12;
  function summary(L) {
    var c = teamOf(L, L.commish);
    return { id: L.id, name: L.name, creator: L.creatorName || (c ? c.manager : ''), private: !!L.lock, salt: L.lock ? L.lock.salt : undefined,
      managers: humans(L).length, size: L.size, status: L.status, created: L.created, open: canJoin(L) };
  }
  function server(store) {
    function ok(extra) { extra = extra || {}; extra.ok = true; extra.now = store.now(); return extra; }
    function strip(L) { var out = JSON.parse(JSON.stringify(L)); delete out.lock; return out; }
    function withLeague(L, key) {
      var t = teamOf(L, key);
      return { league: strip(L), me: t ? t.id : null };
    }
    function ctxFor(L) { return context(store.pool(L.pool), store.now); }
    function checkUser(d) { if (typeof d.user !== 'string' || !ACCOUNT.test(d.user)) fail('bad_account'); }
    function auth(d) {
      checkUser(d);
      var acct = store.account(d.user.toLowerCase());
      if (!acct || typeof d.hash !== 'string' || !same(acct.hash, d.hash)) { store.sleep(400); fail('wrong_login'); }
      acct.leagues = acct.leagues || [];
      return acct;
    }
    function mine(acct) {
      var all = store.leagues(), by = {};
      all.forEach(function (x) { by[x.id] = x; });
      return acct.leagues.filter(function (id) { return by[id]; }).map(function (id) { return by[id]; });
    }
    function member(acct, id) {
      if (typeof id !== 'string' || acct.leagues.indexOf(id) < 0) fail('no_league');
    }
    function current(id) {
      var L = store.league(id);
      if (!L) fail('no_league');
      if (!tick(L, ctxFor(L))) return L;
      return store.lock(function () {
        var fresh = store.league(id);
        if (!fresh) fail('no_league');
        if (tick(fresh, ctxFor(fresh))) { fresh.rev++; store.saveLeague(fresh); }
        return fresh;
      });
    }
    function who(d, acct) { return { owner: acct.key, manager: acct.user, team: d.team, color: d.color }; }
    var actions = {
      salt: function (d) {
        checkUser(d);
        var acct = store.account(d.user.toLowerCase());
        if (!acct) fail('no_account');
        return ok({ salt: acct.salt });
      },
      register: function (d) {
        checkUser(d);
        if (!isB64(d.salt, 64) || !isB64(d.hash, 128)) fail('bad_request');
        var key = d.user.toLowerCase();
        return store.lock(function () {
          if (store.account(key)) fail('taken');
          if (store.accountCount() >= MAX_ACCOUNTS) fail('full');
          store.saveAccount({ key: key, user: d.user, salt: d.salt, hash: d.hash, leagues: [] });
          return ok({ mine: [], leagues: store.leagues() });
        });
      },
      load: function (d) {
        var acct = auth(d), out = { mine: mine(acct), leagues: store.leagues() };
        if (d.league) {
          member(acct, d.league);
          var L = current(d.league), w = withLeague(L, acct.key);
          out.league = w.league; out.me = w.me;
        }
        return ok(out);
      },
      leagues: function (d) { var acct = auth(d); return ok({ mine: mine(acct), leagues: store.leagues() }); },
      poll: function (d) {
        var acct = auth(d);
        member(acct, d.league);
        var L = current(d.league);
        if (+d.since === L.rev) return ok({ same: true, rev: L.rev });
        return ok(withLeague(L, acct.key));
      },
      create: function (d) {
        var acct = auth(d);
        var name = cleanName(d.name, 30);
        if (name.length < 3) fail('bad_league_name');
        if (d['private'] && (!isB64(d.salt, 64) || !isB64(d.pass, 128))) fail('bad_password');
        var size = +d.size || 0, timer = +d.timer || 60;
        if (!(size >= 2 && size <= 12)) fail('bad_size');
        if (TIMERS.indexOf(timer) < 0) fail('bad_request');
        return store.lock(function () {
          if (acct.leagues.length >= MAX_MY_LEAGUES) fail('too_many_leagues');
          if (store.leagues().length >= MAX_LEAGUES) fail('full');
          var url = store.poolUrl(d.pool);
          var C = context(store.pool(url), store.now);
          var L = createLeague(C, { id: store.newLeagueId(), name: name, size: size, owner: acct.key, pool: url });
          L.creatorName = acct.user;
          L.draft.timer = timer;
          if (d['private']) L.lock = { salt: d.salt, hash: d.pass };
          join(L, C, who(d, acct));
          L.rev++;
          store.saveLeague(L);
          acct.leagues.push(L.id);
          store.saveAccount(acct);
          return ok(withLeague(L, acct.key));
        });
      },
      join: function (d) {
        var acct = auth(d);
        return store.lock(function () {
          var L = store.league(String(d.league || ''));
          if (!L) fail('no_league');
          if (teamOf(L, acct.key)) {
            if (acct.leagues.indexOf(L.id) < 0) { acct.leagues.push(L.id); store.saveAccount(acct); }
            return ok(withLeague(L, acct.key));
          }
          if (L.lock && (typeof d.pass !== 'string' || !same(L.lock.hash, d.pass))) { store.sleep(400); fail('wrong_password'); }
          if (acct.leagues.length >= MAX_MY_LEAGUES) fail('too_many_leagues');
          var C = ctxFor(L);
          tick(L, C);
          join(L, C, who(d, acct));
          L.rev++;
          store.saveLeague(L);
          acct.leagues.push(L.id);
          store.saveAccount(acct);
          return ok(withLeague(L, acct.key));
        });
      },
      act: function (d) {
        var acct = auth(d);
        member(acct, d.league);
        if (typeof d.op !== 'string') fail('bad_request');
        return store.lock(function () {
          var L = store.league(d.league);
          if (!L) fail('no_league');
          var C = ctxFor(L);
          tick(L, C);
          var t = teamOf(L, acct.key);
          if (!t) fail('no_team');
          var msg;
          try { msg = apply(L, C, t.id, d.op, d.args && typeof d.args === 'object' ? d.args : {}); }
          catch (e) {
            L.rev++; store.saveLeague(L);
            throw e;
          }
          L.rev++;
          store.saveLeague(L);
          var out = withLeague(L, acct.key);
          out.msg = msg;
          return ok(out);
        });
      },
      leave: function (d) {
        var acct = auth(d);
        member(acct, d.league);
        return store.lock(function () {
          var L = store.league(d.league);
          if (L) {
            var t = teamOf(L, acct.key);
            if (t) { leave(L, ctxFor(L), t.id); L.rev++; store.saveLeague(L); }
          }
          acct.leagues = acct.leagues.filter(function (id) { return id !== d.league; });
          store.saveAccount(acct);
          return ok({ mine: mine(acct), leagues: store.leagues() });
        });
      },
      'delete-league': function (d) {
        var acct = auth(d);
        member(acct, d.league);
        return store.lock(function () {
          var L = store.league(d.league);
          if (!L) fail('no_league');
          if (L.commish !== acct.key) fail('not_commish');
          store.deleteLeague(L.id);
          acct.leagues = acct.leagues.filter(function (id) { return id !== d.league; });
          store.saveAccount(acct);
          return ok({ mine: mine(acct), leagues: store.leagues() });
        });
      },
      'delete': function (d) {
        var acct = auth(d);
        return store.lock(function () {
          acct.leagues.forEach(function (id) {
            var L = store.league(id);
            if (!L) return;
            var t = teamOf(L, acct.key);
            if (t) { leave(L, ctxFor(L), t.id); L.rev++; store.saveLeague(L); }
          });
          store.deleteAccount(acct.key);
          return ok();
        });
      }
    };
    return function handle(d) {
      try {
        if (!d || !actions.hasOwnProperty(d.action)) fail('bad_request');
        return actions[d.action](d);
      } catch (e) {
        return { ok: false, error: e.code || 'server', detail: e.code ? undefined : String(e && e.message || e) };
      }
    };
  }
  function isB64(s, maxLen) { return typeof s === 'string' && s.length > 0 && s.length <= maxLen && B64.test(s); }
  function same(a, b) {
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    for (var i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  return {
    VERSION: VERSION, TIMERS: TIMERS, context: context, pts: pts, played: played, game: game, weekState: weekState,
    locked: locked, fits: fits, team: team, teamOf: teamOf, humans: humans, ownerOf: ownerOf, onWaivers: onWaivers,
    lineup: lineup, teamScore: teamScore, standings: standings, results: results, playoffs: playoffs, champion: champion,
    allMatchups: allMatchups, teamMatchup: teamMatchup, regDone: regDone, onClock: onClock, drafted: drafted,
    totalPicks: totalPicks, openSlot: openSlot, canSwap: canSwap, lineupValue: lineupValue, apply: apply, tick: tick,
    canJoin: canJoin, abbrev: abbrev, server: server, rng: rng, summary: summary
  };
})();
