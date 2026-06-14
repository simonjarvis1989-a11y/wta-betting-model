var supabaseJs = require('@supabase/supabase-js');
var createClient = supabaseJs.createClient;
require('dotenv').config();

var CONFIG = {
    START_YEAR: 2010,
    END_YEAR: 2026,
    BASE_URL: 'https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master',
    BATCH_SIZE: 500,
};

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

function parseCSV(csvText) {
    var lines = csvText.trim().split(String.fromCharCode(10));
    if (lines.length < 2) return [];
    var headers = lines[0].split(',');
    var rows = [];
    for (var i = 1; i < lines.length; i++) {
        var values = parseCSVLine(lines[i]);
        if (values.length !== headers.length) continue;
        var row = {};
        for (var j = 0; j < headers.length; j++) {
            var val = values[j];
            row[headers[j].trim()] = (val && val.trim()) ? val.trim() : null;
        }
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line) {
    var result = [];
    var current = '';
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
        var ch = line[i];
        if (ch === '"') { inQuotes = !inQuotes; }
        else if (ch === ',' && !inQuotes) { result.push(current); current = ''; }
        else { current += ch; }
    }
    result.push(current);
    return result;
}

function parseDate(dateStr) {
    if (!dateStr || dateStr.length < 8) return null;
    return dateStr.substring(0, 4) + '-' + dateStr.substring(4, 6) + '-' + dateStr.substring(6, 8);
}

function safeInt(val) {
    if (!val || val === '') return null;
    var num = parseInt(val);
    return isNaN(num) ? null : num;
}

async function downloadYearData(year) {
    var url = CONFIG.BASE_URL + '/wta_matches_' + year + '.csv';
    console.log('  Downloading: wta_matches_' + year + '.csv ...');
    try {
        var response = await fetch(url);
        if (!response.ok) {
            console.log('  Warning: No data for ' + year + ', skipping.');
            return null;
        }
        return await response.text();
    } catch (error) {
        console.log('  Error downloading ' + year + ': ' + error.message);
        return null;
    }
}

function extractPlayers(matches) {
    var players = new Map();
    for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        if (match.winner_id && !players.has(match.winner_id)) {
            players.set(match.winner_id, {
                player_id: match.winner_id,
                full_name: match.winner_name || 'Unknown',
                hand: match.winner_hand || null,
                height_cm: safeInt(match.winner_ht),
                country_code: match.winner_ioc || null,
            });
        }
        if (match.loser_id && !players.has(match.loser_id)) {
            players.set(match.loser_id, {
                player_id: match.loser_id,
                full_name: match.loser_name || 'Unknown',
                hand: match.loser_hand || null,
                height_cm: safeInt(match.loser_ht),
                country_code: match.loser_ioc || null,
            });
        }
    }
    return Array.from(players.values());
}

async function upsertPlayers(players) {
    if (players.length === 0) return;
    console.log('  Upserting ' + players.length + ' players...');
    for (var i = 0; i < players.length; i += CONFIG.BATCH_SIZE) {
        var batch = players.slice(i, i + CONFIG.BATCH_SIZE);
        var result = await supabase.from('players').upsert(batch, { onConflict: 'player_id', ignoreDuplicates: true });
        if (result.error) console.log('  Error inserting players: ' + result.error.message);
    }
}

async function insertMatches(matches, year) {
    if (matches.length === 0) return;
    console.log('  Inserting ' + matches.length + ' matches for ' + year + '...');
    var formatted = [];
    for (var i = 0; i < matches.length; i++) {
        var m = matches[i];
        if (!m.winner_id || !m.loser_id) continue;
        formatted.push({
            tourney_id: m.tourney_id,
            tourney_name: m.tourney_name,
            surface: m.surface || 'Hard',
            tourney_level: m.tourney_level,
            tourney_date: parseDate(m.tourney_date),
            match_num: safeInt(m.match_num),
            round: m.round,
            best_of: safeInt(m.best_of) || 3,
            winner_id: m.winner_id,
            winner_name: m.winner_name,
            winner_seed: safeInt(m.winner_seed),
            winner_rank: safeInt(m.winner_rank),
            loser_id: m.loser_id,
            loser_name: m.loser_name,
            loser_seed: safeInt(m.loser_seed),
            loser_rank: safeInt(m.loser_rank),
            score: m.score,
            minutes: safeInt(m.minutes),
        });
    }
    var inserted = 0;
    for (var i = 0; i < formatted.length; i += CONFIG.BATCH_SIZE) {
        var batch = formatted.slice(i, i + CONFIG.BATCH_SIZE);
        var result = await supabase.from('matches').upsert(batch, { onConflict: 'tourney_id,match_num', ignoreDuplicates: true });
        if (result.error && result.error.message.indexOf('duplicate') === -1) {
            console.log('  Error inserting matches: ' + result.error.message);
        } else {
            inserted += batch.length;
        }
    }
    console.log('  Done: ' + inserted + ' matches processed for ' + year);
}

async function main() {
    console.log('============================================');
    console.log('WTA DATA LOADER - Tennis Abstract to Supabase');
    console.log('============================================');
    console.log('Loading years: ' + CONFIG.START_YEAR + ' to ' + CONFIG.END_YEAR);
    console.log('');
    var check = await supabase.from('players').select('player_id').limit(1);
    if (check.error) {
        console.log('Cannot connect to Supabase. Check your .env file.');
        console.log('Error: ' + check.error.message);
        process.exit(1);
    }
    console.log('Connected to Supabase!');
    var totalMatches = 0;
    for (var year = CONFIG.START_YEAR; year <= CONFIG.END_YEAR; year++) {
        console.log('--- ' + year + ' ---');
        var csvText = await downloadYearData(year);
        if (!csvText) continue;
        var matches = parseCSV(csvText);
        console.log('  Parsed ' + matches.length + ' matches');
        if (matches.length === 0) continue;
        var players = extractPlayers(matches);
        await upsertPlayers(players);
        await insertMatches(matches, year);
        totalMatches += matches.length;
        await new Promise(function(resolve) { setTimeout(resolve, 500); });
    }
    console.log('============================================');
    console.log('DONE! Total matches loaded: ' + totalMatches);
    console.log('============================================');
    console.log('Next step: node 04_calculate_elo.js');
}

main().catch(function(err) { console.error('Fatal error:', err); process.exit(1); });
