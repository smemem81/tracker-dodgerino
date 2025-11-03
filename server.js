/*
* ======================================
* DODGE TOOL - BACKEND (server.js)
* ======================================
* VERSION 10.0 - FINAL COMPLETE LOGIC WITH CORS FIX
* 1. CORS is enabled to allow GitHub Pages to communicate with Railway.
* 2. All previous logic (Time formatting, High-Elo window, 403 handling) is included.
*/

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors'); // <-- ADDED CORS
const app = express();

// --- CONFIGURATION ---
const RIOT_API_KEY = process.env.RIOT_API_KEY; 
const DELAY_BETWEEN_PLAYERS = 2000;
const HIGH_RISK_MINUTES = 15;
// ---------------------

// --- DATA CACHE ---
let championIdMap = {};
let championKeyMap = {};
let LATEST_PATCH_VERSION = "15.21.1"; 
// ---------------------

// --- CORS FIX: Allow requests from your GitHub Pages domain ---
const allowedOrigins = ['https://smemem81.github.io', 'http://localhost:3000', 'http://localhost:8000']; 
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or local requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'), false);
    }
  }
};

app.use(cors(corsOptions)); // <-- ENABLE CORS
app.use(express.json());
app.use(express.static('.'));

// --- HELPER FUNCTIONS ---

const delay = ms => new Promise(res => setTimeout(res, ms));

// --- NEW FUNCTION: Formats minutes into human-readable string ---
const formatTimeAgo = (minutes) => {
    if (minutes === 0) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
};
// --- END NEW FUNCTION ---

const getPlatformUrl = (region) => {
    const platforms = {
        'BR1': 'br1.api.riotgames.com', 'EUN1': 'eun1.api.riotgames.com',
        'EUW1': 'euw1.api.riotgames.com', 'JP1': 'jp1.api.riotgames.com',
        'KR': 'kr.api.riotgames.com', 'LA1': 'la1.api.riotgames.com',
        'LA2': 'la2.api.riotgames.com', 'NA1': 'na1.api.riotgames.com',
        'OC1': 'oc1.api.riotgames.com', 'TR1': 'tr1.api.riotgames.com',
        'RU': 'ru.api.riotgames.com', 'PH2': 'ph2.api.riotgames.com',
        'SG2': 'sg2.api.riotgames.com', 'TH2': 'th2.api.riotgames.com',
        'TW2': 'tw2.api.riotgames.com', 'VN2': 'vn2.api.riotgames.com',
    };
    return platforms[region.toUpperCase()];
}

const getRegionalUrl = (region) => {
    const regionMap = {
        'BR1': 'americas.api.riotgames.com', 'LA1': 'americas.api.riotgames.com', 'LA2': 'americas.api.riotgames.com', 'NA1': 'americas.api.riotgames.com',
        'EUN1': 'europe.api.riotgames.com', 'EUW1': 'europe.api.riotgames.com', 'TR1': 'europe.api.riotgames.com', 'RU': 'europe.api.riotgames.com',
        'JP1': 'asia.api.riotgames.com', 'KR': 'asia.api.riotgames.com', 'PH2': 'asia.api.riotgames.com', 'SG2': 'asia.api.riotgames.com', 'TH2': 'asia.api.riotgames.com', 'TW2': 'asia.api.riotgames.com', 'VN2': 'asia.api.riotgames.com',
    };
    return regionMap[region.toUpperCase()];
}

/**
 * Loads the latest patch version and champion data from Data Dragon.
 */
const loadChampionData = async () => {
    try {
        console.log("[Data Dragon] Fetching latest patch version...");
        const versionResponse = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await versionResponse.json();
        LATEST_PATCH_VERSION = versions[0];
        console.log(`[Data Dragon] Latest patch set to: ${LATEST_PATCH_VERSION}`);

        console.log("[Data Dragon] Fetching champion.json...");
        const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${LATEST_PATCH_VERSION}/data/en_US/champion.json`);
        const json = await response.json();
        const champions = json.data;

        const tempIdMap = {};
        const tempKeyMap = {};

        for (const champKey in champions) {
            const champData = champions[champKey];
            tempIdMap[champData.key] = champData.id;
            tempKeyMap[champData.name] = champData.id;
        }

        championIdMap = tempIdMap;
        championKeyMap = tempKeyMap;
        console.log(`[Data Dragon] Loaded ${Object.keys(championIdMap).length} champions.`);

    } catch (error) {
        console.error("[Data Dragon] Failed to load champion data:", error);
    }
}

/**
 * Gets the correct champion image key (e.g., "Wukong" -> "MonkeyKing")
 */
const getChampionKey = (champName) => {
    if (championKeyMap[champName]) {
        return championKeyMap[champName];
    }
    return champName; 
}

/**
 * Converts a list of champion IDs to champion IMAGE KEYS.
 */
const convertBanIdsToImageKeys = (banIds) => {
    return banIds.map(id => championIdMap[id] || 'Unknown');
}

/**
 * Processes data for a single match
 */
const processMatchData = (matchData, puuid) => {
    if (!matchData || !matchData.info) return null;

    const info = matchData.info;
    let trackedPlayerStats = null;
    let win = false;
    const team1BanIds = [];
    const team2BanIds = [];
    const team1 = [];
    const team2 = [];

    info.teams[0].bans.forEach(ban => team1BanIds.push(ban.championId));
    info.teams[1].bans.forEach(ban => team2BanIds.push(ban.championId));

    for (const p of info.participants) {
        const participant = {
            gameName: p.riotIdGameName,
            tagLine: `#${p.riotIdTagline}`,
            championPlayed: getChampionKey(p.championName)
        };
        if (p.teamId === 100) team1.push(participant);
        else team2.push(participant);

        if (p.puuid === puuid) {
            trackedPlayerStats = {
                championPlayed: getChampionKey(p.championName),
                kda: `${p.kills}/${p.deaths}/${p.assists}`,
                win: p.win
            };
            win = p.win;
        }
    }

    const team1Bans = convertBanIdsToImageKeys(team1BanIds);
    const team2Bans = convertBanIdsToImageKeys(team2BanIds);

    return {
        win: win,
        championPlayed: trackedPlayerStats ? trackedPlayerStats.championPlayed : 'Unknown',
        kda: trackedPlayerStats ? trackedPlayerStats.kda : 'N/A',
        team1Bans: team1Bans, 
        team2Bans: team2Bans,
        team1: team1,
        team2: team2,
    };
}


// --- THE MAIN STATUS CHECK FUNCTION ---
const getPlayerStatus = async (region, gameName, tagLine, champToTrack) => {
    const platform = getPlatformUrl(region); 
    const regional = getRegionalUrl(region); 
    
    // --- Utility function for authenticated fetch (used for all API calls) ---
    const authenticatedFetch = async (url) => {
        const response = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });
        console.log(`[API Response] Status: ${response.status} for URL: ${url}`);
        return response;
    };
    
    // --- 1. Get PUUID from Riot ID (Uses Regional) ---
    const accountResponse = await authenticatedFetch(`https://${regional}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
    const accountData = accountResponse.ok ? await accountResponse.json() : null;
    if (!accountResponse.ok || !accountData) return { status: 'ERROR', statusMessage: 'Player Not Found', id: `${region}-${gameName}-${tagLine}` };
    const puuid = accountData.puuid;

    // --- 2. Get Summoner ID & Profile Icon ID (Uses Platform) ---
    const summonerResponse = await authenticatedFetch(`https://${platform}/lol/summoner/v4/summoners/by-puuid/${puuid}`);
    const summonerData = summonerResponse.ok ? await summonerResponse.json() : null;
    if (!summonerResponse.ok || !summonerData) return { status: 'ERROR', statusMessage: 'Summoner Not Found', id: `${region}-${gameName}-${tagLine}` };

    const profileIconUrl = `https://ddragon.leagueoflegends.com/cdn/${LATEST_PATCH_VERSION}/img/profileicon/${summonerData.profileIconId}.png`;
    const champImageKey = getChampionKey(champToTrack) || champToTrack;

    // --- 3. Check for Live Game (V5 - Regional Routing) ---
    const spectatorURL = `https://${regional}/lol/spectator/v5/active-games/by-puuid/${puuid}`;
    const liveGameResponse = await authenticatedFetch(spectatorURL);
    
    // --- CASE A: Success (200 OK) - Player is viewable and in game ---
    if (liveGameResponse.ok) {
        const liveGameData = await liveGameResponse.json();
        
        const gameStartTime = liveGameData.gameStartTime;
        const elapsedSeconds = Math.floor((Date.now() - gameStartTime) / 1000);
        
        const blueBanIds = liveGameData.bannedChampions.filter(b => b.teamId === 100).map(b => b.championId);
        const redBanIds = liveGameData.bannedChampions.filter(b => b.teamId === 200).map(b => b.championId);
        
        const blueBans = convertBanIdsToImageKeys(blueBanIds);
        const redBans = convertBanIdsToImageKeys(redBanIds);
        const allBans = [...blueBans, ...redBans];
        const champBanned = allBans.some(ban => ban.toLowerCase() === champImageKey.toLowerCase());

        return {
            status: 'IN_GAME',
            statusMessage: `IN GAME (${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')})`,
            isChampBanned: champBanned,
            profileIconUrl: profileIconUrl,
            liveGameDetails: {
                gameStartTime: gameStartTime,
                team1Bans: blueBans,
                team2Bans: redBans,
                team1: liveGameData.participants
                    .filter(p => p.teamId === 100)
                    .map(p => ({ gameName: p.summonerName || p.summonerId, tagLine: '', championPlayed: championIdMap[p.championId] || 'Unknown' })),
                team2: liveGameData.participants
                    .filter(p => p.teamId === 200)
                    .map(p => ({ gameName: p.summonerName || p.summonerId, tagLine: '', championPlayed: championIdMap[p.championId] || 'Unknown' }))
            }
        };
    }
    
    // --- 4. Get last match. (Used for all fallthroughs: 403, 404, or other errors) ---
    const matchListResponse = await authenticatedFetch(`https://${regional}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=1`);
    
    const matchList = matchListResponse.ok ? await matchListResponse.json() : [];
    if (matchList.length === 0) {
        return { status: 'LOW_RISK', statusMessage: 'No recent games', isChampBanned: null, profileIconUrl: profileIconUrl };
    }

    const lastMatchId = matchList[0];
    const matchDataResponse = await authenticatedFetch(`https://${regional}/lol/match/v5/matches/${lastMatchId}`);
    
    const finalMatchData = matchDataResponse.ok ? await matchDataResponse.json() : null;

    if (!finalMatchData || !finalMatchData.info) {
        return { status: 'ERROR', statusMessage: 'Match History Error', isChampBanned: null, profileIconUrl: profileIconUrl };
    }

    // --- 5. Process Last Match Data ---
    const gameEndTimestamp = finalMatchData.info.gameEndTimestamp; 
    
    let minutesAgo = 0; 
    if (gameEndTimestamp && typeof gameEndTimestamp === 'number' && gameEndTimestamp > 0) {
        minutesAgo = Math.floor((Date.now() - gameEndTimestamp) / 60000);
    }
    
    const fullMatchDetails = processMatchData(finalMatchData, puuid); 
    const champBanned = [...(fullMatchDetails.team1Bans || []), ...(fullMatchDetails.team2Bans || [])]
        .some(ban => ban.toLowerCase() === champImageKey.toLowerCase());
    
    // Format the time once for use in all subsequent messages
    const formattedTime = formatTimeAgo(minutesAgo);
        
    if (minutesAgo <= HIGH_RISK_MINUTES) {
        // High Risk/Inferred Online Window (0-15 minutes ago)
        
        if (liveGameResponse.status === 403) {
            // Case 1: 403 (Policy Block) + Recent Game -> Streamer Mode Warning
            return { 
                status: 'HIGH_RISK', 
                statusMessage: `BE CAREFUL (${formattedTime})`, 
                isChampBanned: null, 
                profileIconUrl: profileIconUrl,
                lastMatchDetails: fullMatchDetails
            };
        } else {
             // Case 2: 404 Not Found + Recent Game -> Standard High Risk (In Queue/Champ Select)
             return {
                status: 'HIGH_RISK',
                statusMessage: `HIGH RISK (${formattedTime})`,
                isChampBanned: champBanned,
                profileIconUrl: profileIconUrl,
                lastMatchDetails: fullMatchDetails
            };
        }
    }

    // --- STANDARD LOW RISK CHECK (Last game ended > 15m ago) ---
    return {
        status: 'LOW_RISK',
        statusMessage: `LOW RISK (${formattedTime})`,
        isChampBanned: champBanned,
        profileIconUrl: profileIconUrl,
        lastMatchDetails: fullMatchDetails
    };
}


// --- THE MAIN API ENDPOINT ---
app.post('/check-status', async (req, res) => {
    const { players, champToTrack } = req.body;
    console.log(`[Server] Received check request for ${players.length} players. Tracking: ${champToTrack}`);
    
    const allStatuses = [];
    
    for (const player of players) {
        console.log(`[Server] Checking ${player.gameName}#${player.tagLine} on ${player.region}...`);
        const status = await getPlayerStatus(player.region, player.gameName, player.tagLine, champToTrack);
        allStatuses.push({ ...status, id: player.id });
        await delay(DELAY_BETWEEN_PLAYERS);
    }

    console.log(`[Server] Check complete. Sending ${allStatuses.length} statuses to frontend.`);
    res.json(allStatuses);
});

// Start the server
console.log("[Server] Initializing...");
loadChampionData().then(() => {
    // Uses process.env.PORT provided by the hosting environment
    const serverPort = process.env.PORT || 3000; 
    app.listen(serverPort, () => {
        console.log(`====================================================`);
        console.log(`  Dodge Tool Backend Server IS RUNNING`);
        console.log(`  Server listening on port ${serverPort}.`);
        console.log(`====================================================`);
    });
});