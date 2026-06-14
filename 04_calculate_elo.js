var supabaseJs = require('@supabase/supabase-js');
var createClient = supabaseJs.createClient;
require('dotenv').config();
var elo = require('./02_elo_engine');
var ELO_CONFIG = elo.ELO_CONFIG;
var calculateNewRatings = elo.calculateNewRatings;

var SAVE_HISTORY = process.argv.indexOf('--no-history') === -1;
var BATCH_SIZE = 1000;

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

var ratings = new Map();

function getPlayerRating(playerId) {
    if (!ratings.has(playerId)) {
        ratings.set(playerId, {
            player_id: playerId,
            overall_elo: ELO_CONFIG.START_ELO,
            hard_elo: ELO_CONFIG.START_ELO,
            clay_elo: ELO_CONFIG.START_ELO,
            grass_elo: ELO_CONFIG.START_ELO,
            matches_played: 0,
            last_match_date: null,
        });
    }
    return ratings.get(playerId);
}

function getSurfaceElo(r, surface) {
    var s = (surface || '').toLowerCase();
    if (s === 'hard') return r.hard_elo;
    if (s === 'clay') return r.clay_elo;
    if (s === 'grass') return r.grass_elo;
    return r.overall_elo;
}

function setSurfaceElo(r, surface, val) {
    var s = (surface || '').toLowerCase();
    if (s === 'hard') r.hard_elo = val;
    else if (s === 'clay') r.clay_elo = val;
    else if (s === 'grass') r.grass_elo = val;
}

async function fetchAllMatches() {
    console.log('Fetching matches from database...');
    var allMatches = [];
    var offset = 0;
    var hasMore = true;
    while (hasMore) {
        var result = await supabase
            .from('matches')
            .select('id, tourney_id, tourney_name, surface, tourney_level, tourney_date, match_num, round, winner_id, winner_name, loser_id, loser_name')
            .order('tourney_date', { ascending: true })
            .order('match_num', { ascending: true })
            .range(offset, offset + BATCH_SIZE - 1);
        if (result.error) { console.error('Error fetching matches:', result.error.message); process.exit(1); }
        if (result.data.length === 0) { hasMore = false; }
        else { allMatches = allMatches.concat(result.data); offset += BATCH_SIZE; }
    }
    console.log('Total matches to process: ' + allMatches.length);
    return allMatches;
}

function processMatches(matches) {
    console.log('
Calculating Elo ratings...');
    var history = [];
    for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        var winnerId = match.winner_id;
        var loserId = match.loser_id;
        var surface = match.surface || 'Hard';
        var tourneyLevel = match.tourney_level || '';
        if (!winnerId || !loserId) continue;
        var wr = getPlayerRating(winnerId);
        var lr = getPlayerRating(loserId);
        var wEloBefore = wr.overall_elo;
        var wSurfBefore = getSurfaceElo(wr, surface);
        var lEloBefore = lr.overall_elo;
        var lSurfBefore = getSurfaceElo(lr, surface);
        var res = calculateNewRatings(
            { overallElo: wr.overall_elo, surfaceElo: getSurfaceElo(wr, surface), matchesPlayed: wr.matches_played },
            { overallElo: lr.overall_elo, surfaceElo: getSurfaceElo(lr, surface), matchesPlayed: lr.matches_played },
            surface, tourneyLevel
        );
        wr.overall_elo = res.winner.overallElo;
        setSurfaceElo(wr, surface, res.winner.surfaceElo);
        wr.matches_played = res.winner.matchesPlayed;
        wr.last_match_date = match.tourney_date;
        lr.overall_elo = res.loser.overallElo;
        setSurfaceElo(lr, surface, res.loser.surfaceElo);
        lr.matches_played = res.loser.matchesPlayed;
        lr.last_match_date = match.tourney_date;
        if (SAVE_HISTORY) {
            history.push({ player_id: winnerId, match_id: match.id, match_date: match.tourney_date, surface: surface, elo_before: wEloBefore, elo_after: res.winner.overallElo, surface_elo_before: wSurfBefore, surface_elo_after: res.winner.surfaceElo, opponent_elo: lEloBefore, result: 'W' });
            history.push({ player_id: loserId, match_id: match.id, match_date: match.tourney_date, surface: surface, elo_before: lEloBefore, elo_after: res.loser.overallElo, surface_elo_before: lSurfBefore, surface_elo_after: res.loser.surfaceElo, opponent_elo: wEloBefore, result: 'L' });
        }
    }
    console.log('Processed ' + matches.length + ' matches');
    return history;
}

async function saveRatings() {
    console.log('
Saving ratings...');
    var playerIds = Array.from(ratings.keys());
    var playerNames = new Map();
    for (var i = 0; i < playerIds.length; i += BATCH_SIZE) {
        var batch = playerIds.slice(i, i + BATCH_SIZE);
        var result = await supabase.from('players').select('player_id, full_name').in('player_id', batch);
        if (result.data) result.data.forEach(function(p) { playerNames.set(p.player_id, p.full_name); });
    }
    var records = [];
    ratings.forEach(function(r) {
        records.push({
            player_id: r.player_id,
            player_name: playerNames.get(r.player_id) || 'Unknown',
            overall_elo: r.overall_elo,
            hard_elo: r.hard_elo,
            clay_elo: r.clay_elo,
            grass_elo: r.grass_elo,
            matches_played: r.matches_played,
            last_match_date: r.last_match_date,
            updated_at: new Date().toISOString(),
        });
    });
    await supabase.from('elo_ratings').delete().neq('player_id', '');
    var saved = 0;
    for (var i = 0; i < records.length; i += BATCH_SIZE) {
        var batch = records.slice(i, i + BATCH_SIZE);
        var result = await supabase.from('elo_ratings').upsert(batch, { onConflict: 'player_id' });
        if (!result.error) saved += batch.length;
        else console.log('Error saving batch:', result.error.message);
    }
    console.log('Saved ratings for ' + saved + ' players');
}

async function saveHistory(history) {
    if (!SAVE_HISTORY || history.length === 0) return;
    console.log('Saving ' + history.length + ' history records...');
    await supabase.from('elo_history').delete().neq('player_id', '');
    var saved = 0;
    for (var i = 0; i < history.length; i += 500) {
        var batch = history.slice(i, i + 500);
        var result = await supabase.from('elo_history').insert(batch);
        if (!result.error) saved += batch.length;
    }
    console.log('Saved ' + saved + ' history records');
}

function printTop() {
    console.log('
--- TOP 20 WTA PLAYERS ---');
    var arr = Array.from(ratings.values());
    var filtered = arr.filter(function(r) { return r.matches_played >= 30; });
    filtered.sort(function(a, b) { return b.overall_elo - a.overall_elo; });
    var top = filtered.slice(0, 20);
    for (var i = 0; i < top.length; i++) {
        var p = top[i];
        console.log((i+1) + '. ' + p.player_id + ' | Overall: ' + p.overall_elo.toFixed(0) + ' | Hard: ' + p.hard_elo.toFixed(0) + ' | Clay: ' + p.clay_elo.toFixed(0) + ' | Grass: ' + p.grass_elo.toFixed(0) + ' | Matches: ' + p.matches_played);
    }
}

async function main() {
    console.log('============================================');
    console.log('WTA ELO CALCULATOR');
    console.log('============================================');
    var check = await supabase.from('matches').select('id').limit(1);
    if (check.error) { console.error('Cannot connect to Supabase:', check.error.message); process.exit(1); }
    var matches = await fetchAllMatches();
    if (matches.length === 0) { console.log('No matches found! Run 03_load_historical_data.js first.'); process.exit(1); }
    var history = processMatches(matches);
    await saveRatings();
    await saveHistory(history);
    printTop();
    console.log('
DONE! Check your elo_ratings table in Supabase.');
}

main().catch(function(err) { console.error('Fatal error:', err); process.exit(1); });
