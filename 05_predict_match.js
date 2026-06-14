var supabaseJs = require('@supabase/supabase-js');
var createClient = supabaseJs.createClient;
require('dotenv').config();
var elo = require('./02_elo_engine');
var predictMatch = elo.predictMatch;
var findValue = elo.findValue;

var supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

async function findPlayer(searchName) {
    var result = await supabase
        .from('elo_ratings')
        .select('*')
        .ilike('player_name', '%' + searchName + '%')
        .limit(5);
    if (result.error) { console.error('Error:', result.error.message); return null; }
    if (!result.data || result.data.length === 0) {
        console.log('Player not found: "' + searchName + '"');
        return null;
    }
    if (result.data.length > 1) {
        console.log('  Found multiple matches for "' + searchName + '":');
        for (var i = 0; i < result.data.length; i++) {
            var p = result.data[i];
            console.log('    - ' + p.player_name + ' (Elo: ' + p.overall_elo + ')');
        }
        console.log('  Using: ' + result.data[0].player_name);
    }
    return result.data[0];
}

async function main() {
    var args = process.argv.slice(2);
    if (args.length < 3) {
        console.log('');
        console.log('Usage: node 05_predict_match.js "Player A" "Player B" Surface [oddsA] [oddsB]');
        console.log('');
        console.log('Examples:');
        console.log('  node 05_predict_match.js "Swiatek" "Sabalenka" Hard');
        console.log('  node 05_predict_match.js "Gauff" "Pegula" Clay 1.65 2.30');
        console.log('');
        process.exit(0);
    }
    var nameA = args[0];
    var nameB = args[1];
    var surface = args[2];
    var bookieOddsA = args[3] ? parseFloat(args[3]) : null;
    var bookieOddsB = args[4] ? parseFloat(args[4]) : null;

    console.log('');
    console.log('============================================');
    console.log('WTA MATCH PREDICTION');
    console.log('============================================');
    console.log('');

    var playerA = await findPlayer(nameA);
    var playerB = await findPlayer(nameB);
    if (!playerA || !playerB) process.exit(1);

    function getSurfElo(player, surf) {
        var s = (surf || '').toLowerCase();
        if (s === 'hard') return Number(player.hard_elo);
        if (s === 'clay') return Number(player.clay_elo);
        if (s === 'grass') return Number(player.grass_elo);
        return Number(player.overall_elo);
    }

    console.log(playerA.player_name + ':');
    console.log('  Overall: ' + Number(playerA.overall_elo).toFixed(0) + ' | Hard: ' + Number(playerA.hard_elo).toFixed(0) + ' | Clay: ' + Number(playerA.clay_elo).toFixed(0) + ' | Grass: ' + Number(playerA.grass_elo).toFixed(0));
    console.log('  Matches: ' + playerA.matches_played);
    console.log('');
    console.log(playerB.player_name + ':');
    console.log('  Overall: ' + Number(playerB.overall_elo).toFixed(0) + ' | Hard: ' + Number(playerB.hard_elo).toFixed(0) + ' | Clay: ' + Number(playerB.clay_elo).toFixed(0) + ' | Grass: ' + Number(playerB.grass_elo).toFixed(0));
    console.log('  Matches: ' + playerB.matches_played);

    var prediction = predictMatch(
        { name: playerA.player_name, overallElo: Number(playerA.overall_elo), surfaceElo: getSurfElo(playerA, surface) },
        { name: playerB.player_name, overallElo: Number(playerB.overall_elo), surfaceElo: getSurfElo(playerB, surface) },
        surface
    );

    console.log('');
    console.log('--- PREDICTION (Surface: ' + surface + ') ---');
    console.log(prediction.playerA.name + ': ' + prediction.playerA.winProbability + '% chance | Fair odds: ' + prediction.playerA.impliedOdds);
    console.log(prediction.playerB.name + ': ' + prediction.playerB.winProbability + '% chance | Fair odds: ' + prediction.playerB.impliedOdds);

    if (bookieOddsA && bookieOddsB) {
        console.log('');
        console.log('--- VALUE CHECK ---');
        var valueA = findValue(prediction.playerA.winProbability / 100, bookieOddsA);
        var valueB = findValue(prediction.playerB.winProbability / 100, bookieOddsB);
        console.log(playerA.player_name + ' @ ' + bookieOddsA + ': Edge ' + valueA.edge + ' | ' + valueA.recommendation);
        console.log(playerB.player_name + ' @ ' + bookieOddsB + ': Edge ' + valueB.edge + ' | ' + valueB.recommendation);
    } else {
        console.log('');
        console.log('Tip: Add bookie odds to check value:');
        console.log('  node 05_predict_match.js "' + nameA + '" "' + nameB + '" ' + surface + ' 1.50 2.60');
    }
    console.log('');
}

main().catch(function(err) { console.error('Error:', err); process.exit(1); });
