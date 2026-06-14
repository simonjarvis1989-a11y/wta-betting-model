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
    if (result.error) { console.error('
