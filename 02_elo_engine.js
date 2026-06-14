var ELO_CONFIG = {
    START_ELO: 1500,
    K_FACTOR: 32,
    K_FACTOR_GRAND_SLAM: 40,
    SURFACE_WEIGHT: 0.20,
    NEW_PLAYER_THRESHOLD: 30,
    NEW_PLAYER_K_MULTIPLIER: 1.5,
};

function expectedProbability(ratingA, ratingB) {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function probabilityToOdds(probability) {
    if (probability <= 0) return 999.99;
    if (probability >= 1) return 1.00;
    return Math.round((1 / probability) * 100) / 100;
}

function oddsToProbability(odds) {
    if (odds <= 1) return 1;
    return 1 / odds;
}

function getBlendedElo(overallElo, surfaceElo) {
    var weight = ELO_CONFIG.SURFACE_WEIGHT;
    return (1 - weight) * overallElo + weight * surfaceElo;
}

function getKFactor(tourneyLevel, matchesPlayed) {
    var k = ELO_CONFIG.K_FACTOR;
    if (tourneyLevel === 'G') {
        k = ELO_CONFIG.K_FACTOR_GRAND_SLAM;
    }
    if (matchesPlayed < ELO_CONFIG.NEW_PLAYER_THRESHOLD) {
        k *= ELO_CONFIG.NEW_PLAYER_K_MULTIPLIER;
    }
    return k;
}

function calculateNewRatings(winner, loser, surface, tourneyLevel) {
    var winnerBlended = getBlendedElo(winner.overallElo, winner.surfaceElo);
    var loserBlended = getBlendedElo(loser.overallElo, loser.surfaceElo);
    var expectedWin = expectedProbability(winnerBlended, loserBlended);
    var expectedLose = 1 - expectedWin;
    var winnerK = getKFactor(tourneyLevel, winner.matchesPlayed);
    var loserK = getKFactor(tourneyLevel, loser.matchesPlayed);
    var winnerOverallChange = winnerK * (1 - expectedWin);
    var loserOverallChange = loserK * (0 - expectedLose);
    var winnerSurfaceChange = winnerK * (1 - expectedWin);
    var loserSurfaceChange = loserK * (0 - expectedLose);
    return {
        winner: {
            overallElo: Math.round((winner.overallElo + winnerOverallChange) * 100) / 100,
            surfaceElo: Math.round((winner.surfaceElo + winnerSurfaceChange) * 100) / 100,
            eloChange: Math.round(winnerOverallChange * 100) / 100,
            matchesPlayed: winner.matchesPlayed + 1,
        },
        loser: {
            overallElo: Math.round((loser.overallElo + loserOverallChange) * 100) / 100,
            surfaceElo: Math.round((loser.surfaceElo + loserSurfaceChange) * 100) / 100,
            eloChange: Math.round(loserOverallChange * 100) / 100,
            matchesPlayed: loser.matchesPlayed + 1,
        },
        prediction: {
            winnerExpectedProb: Math.round(expectedWin * 1000) / 1000,
            winnerImpliedOdds: probabilityToOdds(expectedWin),
            loserExpectedProb: Math.round(expectedLose * 1000) / 1000,
            loserImpliedOdds: probabilityToOdds(expectedLose),
        }
    };
}

function predictMatch(playerA, playerB, surface) {
    var eloA = getBlendedElo(playerA.overallElo, playerA.surfaceElo || playerA.overallElo);
    var eloB = getBlendedElo(playerB.overallElo, playerB.surfaceElo || playerB.overallElo);
    var probA = expectedProbability(eloA, eloB);
    var probB = 1 - probA;
    return {
        playerA: {
            name: playerA.name,
            blendedElo: Math.round(eloA * 100) / 100,
            winProbability: Math.round(probA * 1000) / 10,
            impliedOdds: probabilityToOdds(probA),
        },
        playerB: {
            name: playerB.name,
            blendedElo: Math.round(eloB * 100) / 100,
            winProbability: Math.round(probB * 1000) / 10,
            impliedOdds: probabilityToOdds(probB),
        },
        surface: surface,
        eloDifference: Math.round((eloA - eloB) * 100) / 100,
    };
}

function findValue(yourProbability, bookmakerOdds) {
    var yourOdds = probabilityToOdds(yourProbability);
    var bookmakerProbability = oddsToProbability(bookmakerOdds);
    var edge = yourProbability - bookmakerProbability;
    var edgePercent = Math.round(edge * 1000) / 10;
    var ev = (yourProbability * (bookmakerOdds - 1)) - (1 - yourProbability);
    var evPercent = Math.round(ev * 1000) / 10;
    var rec = 'NO VALUE';
    if (edge > 0.05) rec = 'STRONG VALUE';
    else if (edge > 0.03) rec = 'VALUE BET';
    else if (edge > 0) rec = 'MARGINAL (skip)';
    return {
        yourProbability: Math.round(yourProbability * 1000) / 10 + '%',
        yourImpliedOdds: yourOdds,
        bookmakerOdds: bookmakerOdds,
        bookmakerImpliedProb: Math.round(bookmakerProbability * 1000) / 10 + '%',
        edge: edgePercent + '%',
        expectedValue: evPercent + '%',
        isValueBet: edge > 0.03,
        recommendation: rec,
    };
}

module.exports = {
    ELO_CONFIG: ELO_CONFIG,
    expectedProbability: expectedProbability,
    probabilityToOdds: probabilityToOdds,
    oddsToProbability: oddsToProbability,
    getBlendedElo: getBlendedElo,
    getKFactor: getKFactor,
    calculateNewRatings: calculateNewRatings,
    predictMatch: predictMatch,
    findValue: findValue,
};
