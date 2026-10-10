var Challenge18 = (function () {
  'use strict';
  var VERSION = 7;
  var OFFENSE = ['QB', 'WR'], DEFENSE = ['DEF'];
  var ACCOUNT = /^[A-Za-z0-9_.]{3,20}$/;
  var RUN_ID = /^R[a-z0-9]{6,20}$/;

  function fail(code) { var e = new Error(code); e.code = code; throw e; }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function r1(v) { return Math.round(v * 10) / 10; }
  function num(v, d) { v = +v; return isFinite(v) ? v : d; }

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a += 0x6D2B79F5; var t = a;
      t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function normal(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function poisson(rand, mean) {
    if (!(mean > 0)) return 0;
    if (mean > 30) return Math.max(0, Math.round(mean + normal(rand) * Math.sqrt(mean)));
    var L = Math.exp(-mean), k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  function binom(rand, n, p) { var k = 0; for (var i = 0; i < n; i++) if (rand() < p) k++; return k; }
  function shuffle(arr, rand) {
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function pickWeighted(rand, items, weightOf) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += weightOf(items[i]);
    var x = rand() * total;
    for (i = 0; i < items.length; i++) { x -= weightOf(items[i]); if (x < 0) return items[i]; }
    return items[items.length - 1];
  }
  function isOffense(slot) { return OFFENSE.indexOf(slot) >= 0; }

  function settings(D, modeId) {
    var cfg = D.config, modes = cfg.modes || {};
    var id = modes[modeId] ? modeId : (cfg.default_mode || 'classic');
    var mode = modes[id] || { label: 'Classic', rerolls: 0 };
    var sim = JSON.parse(JSON.stringify(cfg.simulation || {}));
    if (mode.randomness) sim.randomness = num(sim.randomness, 1) * mode.randomness;
    return {
      mode: id, modeLabel: mode.label || id, rerolls: +mode.rerolls || 0, sim: sim,
      suddenDeath: !!mode.sudden_death, oppBoost: +mode.opponent_boost || 0,
      roster: cfg.roster, weights: cfg.slot_weights || {},
      wheel: cfg.wheel || {}
    };
  }

  function context(D, seasonId) {
    var S = D.seasons[String(seasonId)];
    if (!S) fail('bad_season');
    var C = { D: D, S: S, id: S.id, byKey: {}, byTeam: {}, teams: [] };
    S.players.forEach(function (p) {
      C.byKey[p.k] = p;
      (C.byTeam[p.t] = C.byTeam[p.t] || []).push(p);
    });
    var wheel = D.config.wheel || {}, skip = {};
    (wheel.exclude_teams || []).forEach(function (t) { skip[String(t).toLowerCase()] = true; });
    C.teams = S.teams.filter(function (t) { return !skip[t.n.toLowerCase()] && C.byTeam[t.n]; }).map(function (t) { return t.n; });
    return C;
  }
  function ovrAt(p, slot) { var x = p && p.p && p.p[slot]; return x ? x[0] : null; }
  function eligible(C, team, slot, taken) {
    return (C.byTeam[team] || []).filter(function (p) { return ovrAt(p, slot) != null && !taken[p.k]; })
      .sort(function (a, b) { return ovrAt(b, slot) - ovrAt(a, slot) || (a.n < b.n ? -1 : 1); });
  }
  function takenOf(run) { var t = {}; run.roster.forEach(function (x) { t[x.k] = true; }); return t; }

  function newRun(D, o) {
    var C = context(D, o.season), st = settings(D, o.mode);
    return {
      id: o.id, v: VERSION, cv: D.config.version || 1, built: D.built, season: C.id, seasonLabel: C.S.label,
      mode: st.mode, modeLabel: st.modeLabel, user: o.user || '', name: o.name || 'You', created: o.now,
      updated: o.now, status: 'drafting', slots: st.roster.slice(), slot: 0, rerolls: st.rerolls, rerollsStart: st.rerolls,
      pending: null, spins: [], roster: [], league: o.league === 'MFL' ? 'MFL' : 'MCFL'
    };
  }
  function openSlots(run) {
    var filled = {};
    run.roster.forEach(function (x) { filled[x.slot] = true; });
    var out = [];
    run.slots.forEach(function (pos, i) { if (!filled[i]) out.push([i, pos]); });
    return out;
  }
  function teamOffer(C, team, run, taken) {
    var open = {};
    openSlots(run).forEach(function (o) { open[o[1]] = true; });
    var best = function (x) { return Math.max.apply(null, Object.keys(x[2]).map(function (q) { return x[2][q][0]; })); };
    return (C.byTeam[team] || []).filter(function (p) { return !taken[p.k]; }).map(function (p) {
      var at = {};
      Object.keys(open).forEach(function (pos) { var o = ovrAt(p, pos); if (o != null) at[pos] = [o, p.p[pos][1] ? 1 : 0]; });
      return [p.k, p.n, at];
    }).filter(function (x) { return Object.keys(x[2]).length; })
      .sort(function (a, b) { return best(b) - best(a) || (a[1] < b[1] ? -1 : 1); });
  }
  function offerAt(o, spin) {
    if (o[2] && typeof o[2] === 'object') return o[2];
    var at = {};
    at[spin.pos] = [o[2], o[3] ? 1 : 0];
    return at;
  }
  function spin(D, run, rand, now, reroll) {
    if (run.status !== 'drafting') fail('not_drafting');
    if (run.pending && !reroll) fail('already_spun');
    if (reroll) {
      if (!run.pending) fail('nothing_to_reroll');
      if (run.rerolls <= 0) fail('no_rerolls');
      run.rerolls--;
      run.pending = null;
    }
    var C = context(D, run.season), st = settings(D, run.mode);
    var taken = takenOf(run), used = {};
    run.roster.forEach(function (x) { used[x.spun] = true; });
    var pool = C.teams.filter(function (t) { return st.wheel.repeat_teams !== false || !used[t]; });
    var live = pool.filter(function (t) { return teamOffer(C, t, run, taken).length; });
    if (!live.length) fail('no_players');
    var tw = st.wheel.team_weights || {};
    var weight = function (t) { var w = tw[t]; return w == null ? 1 : Math.max(0, +w || 0); };
    var out = [], n = run.spins.filter(function (s) { return s.slot === run.slot; }).length;
    for (var guard = 0; guard < 200; guard++) {
      var team = pickWeighted(rand, pool, weight);
      var offer = teamOffer(C, team, run, taken);
      var s = { slot: run.slot, pos: null, n: ++n, team: team, at: now };
      if (!offer.length) s.empty = true;
      if (reroll && !out.length) s.reroll = true;
      out.push(s);
      run.spins.push(s);
      if (offer.length) {
        s.offer = offer;
        run.pending = team;
        break;
      }
    }
    if (!run.pending || (out.length && out[out.length - 1].empty)) fail('no_players');
    run.updated = now;
    return out;
  }
  function pick(D, run, key, now, pos) {
    if (run.status !== 'drafting') fail('not_drafting');
    if (!run.pending) fail('spin_first');
    var last = run.spins[run.spins.length - 1];
    var o = (last && last.offer || []).filter(function (x) { return x[0] === key; })[0];
    if (!o) fail('not_on_team');
    if (takenOf(run)[key]) fail('already_picked');
    var at = offerAt(o, last), open = openSlots(run);
    if (!pos) pos = Object.keys(at).filter(function (q) { return open.some(function (x) { return x[1] === q; }); })
      .sort(function (a, b) { return at[b][0] - at[a][0]; })[0];
    var spot = open.filter(function (x) { return x[1] === pos; })[0];
    if (!spot) fail('slot_filled');
    if (!at[pos]) fail('cant_play');
    last.picked = key;
    last.pos = pos;
    run.roster.push({ slot: spot[0], pos: pos, k: o[0], n: o[1], t: run.pending, ovr: at[pos][0], prov: !!at[pos][1],
      spun: run.pending, order: run.roster.length + 1 });
    run.pending = null;
    run.slot++;
    run.updated = now;
    if (run.slot >= run.slots.length) {
      run.status = 'ready';
      run.roster.sort(function (a, b) { return a.slot - b.slot; });
      run.team = teamRatings(D, run.roster.map(function (x) { return { pos: x.pos, ovr: x.ovr }; }));
    }
    var mine = run.roster.filter(function (x) { return x.k === key; })[0];
    return mine;
  }

  function replay(D, o) {
    var run = newRun(D, { id: o.id, league: o.league, season: o.season, mode: o.mode, user: o.user, name: o.name, now: o.now });
    var rand = rng(o.seed), moves = o.moves || [];
    if (!Array.isArray(moves) || moves.length > 200) fail('bad_request');
    run.seed = o.seed;
    moves.forEach(function (m) {
      if (!Array.isArray(m)) fail('bad_request');
      if (m[0] === 's' || m[0] === 'r') spin(D, run, rand, o.now, m[0] === 'r');
      else if (m[0] === 'p') pick(D, run, String(m[1] || ''), o.now, String(m[2] || ''));
      else fail('bad_request');
    });
    run.moves = moves.slice();
    if (run.status === 'ready') simulate(D, run, rng((o.seed ^ 0x5bd1e995) >>> 0), o.now);
    return run;
  }
  function ticketText(key, t) { return key + '|' + t.seed + '|' + t.t; }
  function ticketRunId(t) { return 'R' + Number(t.t).toString(36) + Number(t.seed).toString(36); }

  function teamRatings(D, lineup) {
    var w = D.config.slot_weights || {}, off = 0, ow = 0, def = 0, dw = 0;
    lineup.forEach(function (x) {
      var wt = num(w[x.pos], 10);
      if (isOffense(x.pos)) { off += x.ovr * wt; ow += wt; } else { def += x.ovr * wt; dw += wt; }
    });
    var o = ow ? off / ow : 0, d = dw ? def / dw : 0;
    return { ovr: r1((off + def) / Math.max(1, ow + dw)), off: r1(o), def: r1(d) };
  }
  function realLineup(C, team, st) {
    var used = {}, side = {};
    st.roster.forEach(function (slot, i) {
      var best = null;
      (C.byTeam[team] || []).forEach(function (p) {
        var o = ovrAt(p, slot);
        if (o == null || used[p.k]) return;
        if (!best || o > ovrAt(best, slot)) best = p;
      });
      if (best) used[best.k] = true;
      side[i] = { pos: slot, ovr: best ? ovrAt(best, slot) : num(st.sim.replacement_ovr, 60), k: best ? best.k : null };
    });
    return st.roster.map(function (_s, i) { return side[i]; });
  }

  function gameDay(lineup, rand, st, boost) {
    var sd = num(st.sim.form, 4) * num(st.sim.randomness, 1);
    return lineup.map(function (x) {
      var form = normal(rand) * sd;
      return { pos: x.pos, ovr: x.ovr, gr: clamp(x.ovr + (boost || 0) + form, 25, 110), form: form };
    });
  }
  function group(side) {
    var g = { QB: [], WR: [], DEF: [] };
    side.forEach(function (x) { if (g[x.pos]) g[x.pos].push(x.gr); });
    Object.keys(g).forEach(function (k) { g[k].sort(function (a, b) { return b - a; }); });
    var avg = function (arr, d) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : d; };
    return {
      qb: avg(g.QB, 60), wr1: g.WR[0] != null ? g.WR[0] : 60, wr2: g.WR[1] != null ? g.WR[1] : avg(g.WR, 60),
      d1: g.DEF[0] != null ? g.DEF[0] : 60, d2: g.DEF[1] != null ? g.DEF[1] : avg(g.DEF, 60), defAvg: avg(g.DEF, 60)
    };
  }
  function edge(A, B) {
    var qb = 0.4 * (A.qb - B.defAvg);
    var wr = 0.25 * (A.wr1 - B.d1) + 0.25 * (A.wr2 - B.d2);
    return { qb: qb, wr: wr, total: qb + wr };
  }
  function tdValue(rand, sim) {
    var vals = sim.td_values || [[7, 1]];
    return pickWeighted(rand, vals, function (v) { return v[1]; })[0];
  }
  function play(sideA, sideB, homeA, rand, st, avgPts) {
    var sim = st.sim, K = num(sim.points_per_ovr, 0.55), H = homeA ? num(sim.home_field, 2) : -num(sim.home_field, 2);
    var A = group(sideA), B = group(sideB), eA = edge(A, B), eB = edge(B, A);
    var base = num(avgPts, 21);
    var expA = Math.max(3, base + K * eA.total + H / 2), expB = Math.max(3, base + K * eB.total - H / 2);
    var N = Math.max(4, num(sim.drives, 11));
    function drives(exp) {
      var p = clamp(exp / (7 * N), 0.03, 0.85), q = [0, 0, 0, 0], tds = [];
      for (var i = 0; i < N; i++) {
        if (rand() < p) { var v = tdValue(rand, sim); q[Math.min(3, Math.floor(i * 4 / N))] += v; tds.push(Math.min(3, Math.floor(i * 4 / N))); }
      }
      return { q: q, tds: tds };
    }
    var a = drives(expA), b = drives(expB);
    var safeties = { a: 0, b: 0 };
    if (rand() < num(sim.safety_chance, 0)) { var qa = Math.floor(rand() * 4); if (rand() < 0.5) { a.q[qa] += 2; safeties.a++; } else { b.q[qa] += 2; safeties.b++; } }
    var sa = a.q.reduce(function (x, y) { return x + y; }, 0), sb = b.q.reduce(function (x, y) { return x + y; }, 0), ot = false;
    if (sa === sb) {
      ot = true;
      var pa = clamp(0.5 + (expA - expB) / 40, 0.2, 0.8), v = tdValue(rand, sim);
      if (rand() < pa) { sa += v; a.ot = v; a.tds.push(4); } else { sb += v; b.ot = v; b.tds.push(4); }
    }
    return {
      a: sa, b: sb, qa: a.q, qb: b.q, ot: ot, otA: a.ot || 0, otB: b.ot || 0, tdsA: a.tds, tdsB: b.tds, safeties: safeties,
      expA: expA, expB: expB,
      why: {
        qb: r1(K * eA.qb), wr: r1(K * eA.wr), def: r1(-K * eB.total), home: r1(H),
        variance: r1((sa - sb) - (expA - expB)), total: sa - sb
      }
    };
  }

  function profile(C, k, pos) {
    var p = C.byKey[k], m = (C.S.means || {})[pos] || {};
    var r = (p && p.r) || {}, out = {};
    Object.keys(m).forEach(function (s) { out[s] = r[s] != null ? r[s] : m[s]; });
    Object.keys(r).forEach(function (s) { if (out[s] == null) out[s] = r[s]; });
    return out;
  }
  function lines(C, run, day, res, opp, rand) {
    var f = function (x) { return clamp(1 + (x.gr - x.ovr) / 25, 0.4, 1.8); };
    var out = [], wrs = [], qb = null;
    run.roster.forEach(function (x, i) {
      var d = day[i], pr = profile(C, x.k, x.pos), L = { i: i, pos: x.pos, k: x.k, n: x.n, gr: d.gr, ovr: x.ovr, form: f(d) };
      L.pr = pr;
      out.push(L);
      if (x.pos === 'WR') wrs.push(L);
      if (x.pos === 'QB') qb = L;
    });
    var tds = res.tdsA.length;
    var passShare = qb ? clamp((qb.pr.ptd || 1) / ((qb.pr.ptd || 1) + (qb.pr.rtd || 0) + 0.15), 0.55, 0.95) : 0.8;
    wrs.forEach(function (w) { w.td = 0; });
    if (qb) { qb.ptd = 0; qb.rtd = 0; }
    for (var t = 0; t < tds; t++) {
      if (rand() < passShare) {
        if (qb) qb.ptd++;
        var to = wrs.length ? pickWeighted(rand, wrs.concat([null]), function (w) { return w ? 0.3 + (w.pr.wtd || 0) * w.form : 0.25; }) : null;
        if (to) to.td++;
      } else if (qb) qb.rtd++;
    }
    var oppG = group(opp);
    var qbYpg = qb ? (qb.pr.pyd || 150) : 150;
    var cover = function (w, cb) { return clamp(1 + (w.gr - cb) / 60, 0.6, 1.4); };
    var passYds = Math.max(0, Math.round(qbYpg * (qb ? qb.form : 1) * clamp(1 + ((qb ? qb.gr : 70) - oppG.defAvg) / 80, 0.6, 1.4)
      * (0.8 + 0.4 * rand()) + res.tdsA.length * 12));
    var wrW = wrs.map(function (w, j) { return Math.max(10, (w.pr.rec || 3) * (w.pr.ypr || 12)) * w.form * cover(w, j ? oppG.cb2 : oppG.cb1); });
    var sumW = wrW.reduce(function (a, b) { return a + b; }, 0), otherW = sumW * 0.3 + 10;
    var wrYds = 0, wrRec = 0, wrTd = 0;
    wrs.forEach(function (w, j) {
      var ypr = Math.max(5, (w.pr.ypr || 12) * (0.8 + rand() * 0.4));
      w.yds = Math.round(passYds * wrW[j] / (sumW + otherW));
      w.rec = Math.max(w.td, w.yds > 0 ? Math.max(1, Math.round(w.yds / ypr)) : 0);
      if (!w.rec) w.yds = 0;
      w.rush = rand() < 0.2 && w.pr.rush ? Math.round(w.pr.rush * (0.5 + rand())) : 0;
      wrYds += w.yds; wrRec += w.rec; wrTd += w.td;
    });
    if (qb) {
      var otherYds = Math.max(0, passYds - wrYds), otherRec = otherYds ? Math.max(qb.ptd > wrTd ? 1 : 0, Math.round(otherYds / 9)) : 0;
      qb.cmp = wrRec + otherRec;
      var pct = clamp((qb.pr.cpct || 0.55) * (0.85 + 0.3 * rand()) * clamp(qb.form, 0.85, 1.15), 0.3, 0.9);
      qb.att = Math.max(qb.cmp, Math.round(qb.cmp / pct));
      qb.yds = wrYds + otherYds;
      qb.int = poisson(rand, (qb.pr.int || 0.8) * clamp(2 - qb.form, 0.4, 1.6) * clamp(1 + (oppG.defAvg - qb.gr) / 50, 0.6, 1.5));
      qb.rush = Math.max(0, Math.round((qb.pr.ryd || 5) * (0.4 + rand() * 1.2) + qb.rtd * 5));
    }
    out.forEach(function (L) {
      if (!isOffense(L.pos)) {
        L.tkl = poisson(rand, (L.pr.tkl || 3) * L.form);
        L.sck = poisson(rand, (L.pr.sck || 0.2) * L.form * clamp(1 + (L.gr - oppG.qb) / 40, 0.5, 1.6));
        L.int = poisson(rand, (L.pr.dint || 0.15) * L.form * clamp(1 + (L.gr - oppG.qb) / 40, 0.5, 1.6));
        L.pd = poisson(rand, (L.pr.pd || 0.5) * L.form);
        L.dtd = L.int && rand() < 0.12 ? 1 : 0;
      }
      L.rating = r1(clamp(L.gr + production(L), 30, 99.9));
      L.gr = r1(L.gr);
      delete L.pr; delete L.form;
    });
    return out;
  }
  function production(L) {
    switch (L.pos) {
      case 'QB': return clamp((L.yds - 170) / 40 + (L.ptd || 0) * 1.5 + (L.rtd || 0) * 1.5 - (L.int || 0) * 2.5, -8, 8);
      case 'WR': return clamp((L.yds - 60) / 20 + L.td * 2, -6, 8);
      default: return clamp((L.tkl - 3) * 0.6 + L.sck * 2.5 + L.int * 3 + L.pd + (L.dtd || 0) * 3, -5, 8);
    }
  }

  function lineupValue(D, list) {
    var w = D.config.slot_weights || {}, s = 0, t = 0;
    list.forEach(function (x) { var wt = num(w[x.pos], 10); s += x.ovr * wt; t += wt; });
    return t ? s / t : 0;
  }
  function idealTeam(D, C) {
    var roster = D.config.roster;
    var ranked = function (slot, skip) {
      return C.S.players.filter(function (p) { return ovrAt(p, slot) != null && !(skip && skip[p.k]); })
        .sort(function (a, b) { return ovrAt(b, slot) - ovrAt(a, slot) || (a.k < b.k ? -1 : 1); });
    };
    var cand = roster.map(function (slot) { return ranked(slot).slice(0, 4); });
    var best = null, bestV = -1, cur = [], used = {};
    (function dfs(i) {
      if (i === roster.length) {
        var v = lineupValue(D, cur.map(function (p, j) { return { pos: roster[j], ovr: ovrAt(p, roster[j]) }; }));
        if (v > bestV + 1e-9) { bestV = v; best = cur.slice(); }
        return;
      }
      cand[i].forEach(function (p) {
        if (used[p.k]) return;
        used[p.k] = true; cur.push(p); dfs(i + 1); cur.pop(); delete used[p.k];
      });
    })(0);
    if (!best) return { value: 0, oneOff: 0, vals: {}, parRank: 3, keys: [] };
    var sim = D.config.simulation || {}, parRank = Math.max(1, num(sim.perfect_avg_rank, 3));
    var vals = {}, count = {};
    roster.forEach(function (slot) { count[slot] = (count[slot] || 0) + 1; });
    Object.keys(count).forEach(function (slot) { vals[slot] = ranked(slot).map(function (p) { return ovrAt(p, slot); }); });
    var seen = {}, par = roster.map(function (slot) {
      var j = seen[slot] = (seen[slot] == null ? 0 : seen[slot] + 1), v = vals[slot];
      var o = v.length ? v[Math.min(v.length - 1, Math.round(parRank) - 1 + j)] : 60;
      return { pos: slot, ovr: o };
    });
    var median = roster.map(function (slot) { var r = vals[slot]; return { pos: slot, ovr: r.length ? r[Math.floor(r.length / 2)] : 60 }; });
    return { value: bestV, oneOff: Math.max(0, bestV - lineupValue(D, par)), vals: vals, parRank: parRank,
             spread: Math.max(3, bestV - lineupValue(D, median)), keys: best.map(function (p) { return p.k; }) };
  }
  function winChance(D, run, st, I) {
    var sim = st.sim, gap = I.value - lineupValue(D, run.roster);
    var mine = {}, total = 0, spots = 0;
    run.roster.forEach(function (x) { (mine[x.pos] = mine[x.pos] || []).push(x.ovr); });
    Object.keys(mine).forEach(function (pos) {
      var all = (I.vals || {})[pos] || [];
      mine[pos].sort(function (a, b) { return b - a; }).forEach(function (o, j) {
        var above = all.filter(function (v) { return v > o; }).length;
        total += Math.max(1, above + 1 - j); spots++;
      });
    });
    var avgRank = spots ? total / spots : 99;
    var perfectOk = avgRank <= (I.parRank || 3) + 1e-9;
    var x = Math.max(0, gap - I.oneOff) / I.spread;
    var p = perfectOk ? num(sim.perfect_win_chance, 0.99) : clamp(num(sim.top_win_chance, 0.95) - num(sim.drop_per_spread, 0.55) * x, 0.08, 0.93);
    p -= num(st.oppBoost, 0) * 0.02;
    p = 0.5 + (p - 0.5) / Math.max(0.5, num(sim.randomness, 1));
    return { p: clamp(p, 0.03, 0.995), perfectOk: perfectOk, gap: r1(gap), oneOff: r1(I.oneOff), avgRank: r1(avgRank) };
  }
  function simulate(D, run, rand, now) {
    if (run.status !== 'ready') fail(run.status === 'done' ? 'already_played' : 'roster_not_done');
    var C = context(D, run.season), st = settings(D, run.mode), sim = st.sim;
    var avg = num(C.S.avg, 21), G = Math.max(1, num(sim.regular_season_games, 17));
    var mine = run.roster.map(function (x) { return { pos: x.pos, ovr: x.ovr, k: x.k }; });
    var teams = C.S.teams.map(function (t) { return t.n; }).filter(function (t) { return C.byTeam[t]; });
    var lineups = {};
    teams.forEach(function (t) { lineups[t] = realLineup(C, t, st); });
    var I = idealTeam(D, C), chance = winChance(D, run, st, I);

    var results = [];
    for (var g0 = 0; g0 < G; g0++) results.push(rand() < chance.p);
    if (!chance.perfectOk && results.every(function (r) { return r; })) results[Math.floor(rand() * G)] = false;

    var order = [];
    while (order.length < G) order = order.concat(shuffle(teams.slice(), rand));
    order = order.slice(0, G);
    var games = [], stats = {}, alive = true;
    for (var wk = 1; wk <= G && alive; wk++) {
      var opp = order[wk - 1], home = wk % 2 === 1, want = results[wk - 1], dayA, dayB, res;
      for (var tries = 0; tries < 40; tries++) {
        dayA = gameDay(mine, rand, st, 0); dayB = gameDay(lineups[opp], rand, st, 0);
        res = play(dayA, dayB, home, rand, st, avg);
        if ((res.a > res.b) === want) break;
      }
      if ((res.a > res.b) !== want) {
        var t = res.a; res.a = res.b; res.b = t; t = res.qa; res.qa = res.qb; res.qb = t;
        t = res.tdsA; res.tdsA = res.tdsB; res.tdsB = t;
      }
      var ls = lines(C, run, dayA, res, dayB, rand);
      var g = { wk: wk, opp: opp, home: home, us: res.a, them: res.b, win: res.a > res.b, q: [res.qa, res.qb], ot: res.ot ? [res.otA, res.otB] : null, lines: ls };
      ls.forEach(function (L) {
        var s = stats[L.i] = stats[L.i] || { i: L.i, pos: L.pos, k: L.k, n: L.n, gp: 0, ratings: [] };
        s.gp++; s.ratings.push(L.rating);
        ['cmp', 'att', 'yds', 'ptd', 'rtd', 'int', 'rush', 'rec', 'td', 'sa', 'tkl', 'sck', 'pd', 'dtd'].forEach(function (f) {
          if (L[f] != null) s[f] = (s[f] || 0) + L[f];
        });
      });
      games.push(g);
      if (!g.win && st.suddenDeath) { alive = false; g.eliminated = true; }
    }
    var w = games.filter(function (x) { return x.win; }).length, l = games.length - w;
    var season = Object.keys(stats).map(function (i) {
      var s = stats[i];
      s.rating = r1(s.ratings.reduce(function (a, b) { return a + b; }, 0) / s.ratings.length);
      delete s.ratings;
      return s;
    }).sort(function (a, b) { return a.i - b.i; });
    var perfect = alive && l === 0 && games.length === G;
    run.sim = {
      games: games, regGames: games.length, scheduled: G, stats: season,
      odds: { win: r1(chance.p * 100), gap: chance.gap, oneOff: chance.oneOff, perfectPossible: chance.perfectOk, avgRank: chance.avgRank, ideal: r1(I.value) },
      totals: { pf: games.reduce(function (s, x) { return s + x.us; }, 0), pa: games.reduce(function (s, x) { return s + x.them; }, 0) }
    };
    run.record = { w: w, l: l, rw: w, rl: l, pw: 0, pl: 0 };
    run.result = perfect ? { code: 'perfect', text: 'Perfect season' } : !alive ? { code: 'eliminated', text: 'Eliminated in Week ' + games[games.length - 1].wk } : { code: 'done', text: w + '–' + l };
    run.perfect = perfect;
    run.grade = grade(w, G);
    run.status = 'done';
    run.finished = now;
    run.updated = now;
    return run;
  }
  function grade(w, games) {
    var pct = games ? w / games : 0;
    if (w >= games) return 'A+';
    var steps = [[0.94, 'A'], [0.88, 'A-'], [0.82, 'B+'], [0.76, 'B'], [0.70, 'B-'], [0.64, 'C+'], [0.58, 'C'], [0.52, 'C-'], [0.46, 'D+'], [0.40, 'D'], [0.34, 'D-']];
    for (var i = 0; i < steps.length; i++) if (pct >= steps[i][0]) return steps[i][1];
    return 'F';
  }

  function summary(run) {
    var s = { id: run.id, user: run.user, name: run.name, league: run.league || 'MCFL', season: run.season, mode: run.mode, modeLabel: run.modeLabel,
      status: run.status, created: run.created, finished: run.finished || null, cv: run.cv };
    if (run.team) s.ovr = run.team.ovr;
    if (run.status === 'done') {
      s.record = run.record; s.result = run.result; s.perfect = !!run.perfect;
      s.grade = run.grade || grade(run.record.w, run.record.w + run.record.l);
      s.roster = run.roster.map(function (x) { return [x.pos, x.n, x.ovr]; });
      if (run.unique) s.unique = true;
    }
    return s;
  }
  function lineupKey(league, season, roster) {
    return (league || 'MCFL') + '|' + season + '|' + roster.map(function (x) { return x[0] + ':' + String(x[1]).toLowerCase(); }).sort().join(',');
  }
  function view(run) { return JSON.parse(JSON.stringify(run)); }
  function shareText(run, url) {
    var r = run.record, bar = '━━━━━━━━━━━━━━━━';
    var lines = [bar, '🏈 **17–0 CHALLENGE** · ' + (run.league || 'MCFL') + (run.modeLabel && run.mode !== 'classic' ? ' · ' + run.modeLabel : ''), ''];
    run.roster.forEach(function (x) { lines.push(x.pos + ' — ' + x.n + ' (' + x.ovr + ')'); });
    lines.push('', 'Record: **' + r.w + '–' + r.l + '**  ·  Grade: **' + (run.grade || grade(r.w, r.w + r.l)) + '**');
    if (run.perfect) lines.push('🏆 PERFECT SEASON');
    if (url) lines.push(url);
    lines.push(bar);
    return lines.join('\n');
  }

  var MAX_RUNS_PER_DAY = 150;
  function server(store) {
    function ok(extra) { extra = extra || {}; extra.ok = true; extra.now = store.now(); return extra; }
    function checkUser(d) { if (typeof d.user !== 'string' || !ACCOUNT.test(d.user)) fail('bad_account'); }
    function auth(d) {
      checkUser(d);
      var acct = store.account(d.user.toLowerCase());
      if (acct && typeof d.hash === 'string' && !same(acct.hash, d.hash) && store.account.length > 1) acct = store.account(d.user.toLowerCase(), true);
      if (!acct || typeof d.hash !== 'string' || !same(acct.hash, d.hash)) { store.sleep(400); fail('wrong_login'); }
      return acct;
    }
    function data(d, league) {
      var url = store.dataUrl(d.data);
      if (league === 'MFL') url = url.replace(/server\.json$/, 'mfl-server.json');
      return store.data(url);
    }
    function active(acct) {
      return store.runsOf(acct.key).filter(function (s) { return s.status === 'drafting' || s.status === 'ready'; })[0] || null;
    }
    function own(acct, id) {
      if (typeof id !== 'string' || !RUN_ID.test(id)) fail('no_run');
      var run = store.run(id);
      if (!run || run.user !== acct.key) fail('no_run');
      return run;
    }
    var actions = {
      salt: function (d) {
        checkUser(d);
        var acct = store.account(d.user.toLowerCase());
        if (!acct) fail('no_account');
        return ok({ salt: acct.salt });
      },
      me: function (d) {
        var acct = auth(d), a = active(acct);
        return ok({ user: acct.user, active: a ? view(store.run(a.id)) : null, runs: store.runsOf(acct.key).slice(0, 100) });
      },
      start: function (d) {
        var league = d.league === 'MFL' ? 'MFL' : 'MCFL';
        var acct = auth(d), D = data(d, league);
        if (!D.seasons[String(d.season)]) fail('bad_season');
        return store.lock(function () {
          var mine = store.runsOf(acct.key), a = active(acct);
          if (a && !d.fresh) return ok({ run: view(store.run(a.id)), resumed: true });
          var day = store.now() - 86400000;
          if (mine.filter(function (s) { return s.created > day; }).length >= MAX_RUNS_PER_DAY) fail('slow_down');
          if (a) {
            var old = store.run(a.id);
            old.status = 'abandoned'; old.updated = store.now();
            store.saveRun(old);
          }
          var run = newRun(D, { id: store.newRunId(), league: league, season: d.season, mode: d.mode, user: acct.key, name: acct.user, now: store.now() });
          store.saveRun(run);
          return ok({ run: view(run) });
        });
      },
      ticket: function (d) {
        var acct = auth(d), n = Math.max(1, Math.min(5, Math.floor(+d.count) || 1)), list = [];
        for (var i = 0; i < n; i++) {
          var t = { seed: Math.floor(store.random() * 4294967296), t: store.now() + i };
          t.sig = store.sign(ticketText(acct.key, t));
          list.push(t);
        }
        return ok({ ticket: list[0], tickets: list });
      },
      submit: function (d) {
        var acct = auth(d), t = d.ticket || {};
        if (!(t.seed >= 0 && t.seed < 4294967296 && t.seed % 1 === 0 && t.t > 0 && typeof t.sig === 'string')) fail('bad_ticket');
        if (t.sig !== 'client' && !same(store.sign(ticketText(acct.key, t)), t.sig)) fail('bad_ticket');
        if (store.now() - t.t > 7 * 86400000) fail('old_ticket');
        var id = ticketRunId(t), league = d.league === 'MFL' ? 'MFL' : 'MCFL';
        return store.lock(function () {
          var had = store.run(id);
          if (had) { if (had.user !== acct.key) fail('bad_ticket'); return ok({ run: view(had) }); }
          var D = data(d, league);
          var run = replay(D, { id: id, league: league, season: d.season, mode: d.mode, user: acct.key, name: acct.user, now: store.now(), seed: t.seed, moves: d.moves });
          if (run.status !== 'done') fail('not_finished');
          var mine = lineupKey(run.league, run.season, run.roster.map(function (x) { return [x.pos, x.n]; }));
          run.unique = !store.board().some(function (s) { return s.roster && lineupKey(s.league, s.season, s.roster) === mine; });
          store.saveRun(run);
          return ok({ run: view(run) });
        });
      },
      spin: function (d) {
        var acct = auth(d);
        return store.lock(function () {
          var run = own(acct, d.run), D = data(d, run.league);
          var spins = spin(D, run, store.random, store.now(), !!d.reroll);
          store.saveRun(run);
          return ok({ run: view(run), spins: spins });
        });
      },
      pick: function (d) {
        var acct = auth(d);
        return store.lock(function () {
          var run = own(acct, d.run), D = data(d, run.league);
          pick(D, run, String(d.player || ''), store.now(), typeof d.pos === 'string' ? d.pos : '');
          store.saveRun(run);
          return ok({ run: view(run) });
        });
      },
      simulate: function (d) {
        var acct = auth(d);
        return store.lock(function () {
          var run = own(acct, d.run), D = data(d, run.league);
          simulate(D, run, store.random, store.now());
          store.saveRun(run);
          return ok({ run: view(run) });
        });
      },
      abandon: function (d) {
        var acct = auth(d);
        return store.lock(function () {
          var run = own(acct, d.run);
          if (run.status === 'done') fail('already_played');
          run.status = 'abandoned'; run.updated = store.now();
          store.saveRun(run);
          return ok({ runs: store.runsOf(acct.key).slice(0, 100) });
        });
      },
      run: function (d) {
        if (typeof d.id !== 'string' || !RUN_ID.test(d.id)) fail('no_run');
        var run = store.run(d.id);
        if (!run || run.status !== 'done') fail('no_run');
        return ok({ run: view(run) });
      },
      board: function (d) {
        var rows = store.board().filter(function (s) {
          return (!d.season || String(s.season) === String(d.season)) && (!d.mode || s.mode === d.mode) &&
            (!d.league || (s.league || 'MCFL') === d.league);
        });
        var wins = function (x) { return x.record ? x.record.w : 0; };
        rows.sort(function (a, b) { return wins(b) - wins(a) || (b.ovr || 0) - (a.ovr || 0) || a.finished - b.finished; });
        return ok({ rows: rows.slice(0, 100), total: rows.length });
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
  function same(a, b) {
    a = String(a); b = String(b);
    var diff = a.length ^ b.length;
    for (var i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  return {
    VERSION: VERSION, replay: replay, ticketRunId: ticketRunId, grade: grade, idealTeam: idealTeam, winChance: winChance, settings: settings, openSlots: openSlots, offerAt: offerAt, context: context, eligible: eligible, ovrAt: ovrAt, newRun: newRun, spin: spin,
    pick: pick, teamRatings: teamRatings, realLineup: realLineup, play: play, gameDay: gameDay, simulate: simulate,
    summary: summary, view: view, shareText: shareText, server: server, rng: rng, isOffense: isOffense
  };
})();
