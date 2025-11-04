/*
* ======================================
* FILE: api/get-last-game-participants.js
* ======================================
* NEW FILE. Handles the "Load Last Game" button.
*/

const fetch = require('node-fetch');

// --- CONFIGURATION ---
const RIOT_API_KEY = process.env.RIOT_API_KEY; 
let LATEST_PATCH_VERSION = "15.21.1";
// ---------------------

// --- HELPER FUNCTIONS (Copied from check-status.js) ---
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

const authenticatedFetch = async (url) => {
    if (!RIOT_API_KEY) {
        console.error("[Server Error] RIOT_API_KEY environment variable is not set.");
        return { ok: false, status: 500, statusText: 'Server Configuration Error' };
    }
    const response = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });
    console.log(`[API Response] Status: ${response.status} for URL: ${url}`);
    return response;
};

// Function to get the latest patch (for profile icons)
const loadPatchVersion = async () => {
    try {
        const versionResponse = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await versionResponse.json();
        LATEST_PATCH_VERSION = versions[0];
        console.log(`[Data Dragon] Patch set to ${LATEST_PATCH_VERSION}`);
    } catch (error) {
        console.error("[Data Dragon] Failed to load patch version:", error);
    }
}
// ---------------------

// --- THE MAIN SERVERLESS HANDLER ---
module.exports = async (req, res) => {
    // --- Manual CORS Handling ---
    res.setHeader('Access-Control-Allow-Origin', '*'); 
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method === 'POST') {
        try {
            await loadPatchVersion(); // Ensure patch is loaded
            
            const { gameName, tagLine, region } = req.body;
            if (!gameName || !tagLine || !region) {
                return res.status(400).json({ error: 'Missing gameName, tagLine, or region.' });
            }

            const platform = getPlatformUrl(region); 
            const regional = getRegionalUrl(region); 

            // 1. Get user's PUUID
            const accountResponse = await authenticatedFetch(`https://${regional}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`);
            if (!accountResponse.ok) {
                 if (accountResponse.status === 500) return res.status(500).json({ error: 'Server API Key Error' });
                return res.status(404).json({ error: 'Player Not Found' });
            }
            const accountData = await accountResponse.json();
            const puuid = accountData.puuid; 

            // 2. Get user's last match ID
            const matchListResponse = await authenticatedFetch(`https://${regional}/lol/match/v5/matches/by-puuid/${puuid}/ids?count=1`);
            if (!matchListResponse.ok) {
                return res.status(404).json({ error: 'Match history not found' });
            }
            const matchList = await matchListResponse.json();
            if (matchList.length === 0) {
                return res.status(404).json({ error: 'No recent games found' });
            }
            const lastMatchId = matchList[0];

            // 3. Get that match's data
            const matchDataResponse = await authenticatedFetch(`https://${regional}/lol/match/v5/matches/${lastMatchId}`);
            if (!matchDataResponse.ok) {
                return res.status(500).json({ error: 'Failed to retrieve match data' });
            }
            const finalMatchData = await matchDataResponse.json();
            
            // 4. Process all participants
            const participantPuuids = finalMatchData.info.participants.map(p => p.puuid);
            const participantsDetails = [];

            // 5. Get details for each participant (gameName, tagLine, profileIcon)
            for (const pPuuid of participantPuuids) {
                // Get Summoner data for profile icon
                const summonerResponse = await authenticatedFetch(`https://${platform}/lol/summoner/v4/summoners/by-puuid/${pPuuid}`);
                let profileIconId = '0'; // Default icon
                if (summonerResponse.ok) {
                    const summonerData = await summonerResponse.json();
                    profileIconId = summonerData.profileIconId;
                }
                
                // Get Account data for Riot ID
                const pAccountResponse = await authenticatedFetch(`https://${regional}/riot/account/v1/accounts/by-puuid/${pPuuid}`);
                 let pGameName = 'Unknown';
                 let pTagLine = 'ERROR';
                 if (pAccountResponse.ok) {
                    const pAccountData = await pAccountResponse.json();
                    pGameName = pAccountData.gameName;
                    pTagLine = pAccountData.tagLine;
                 }

                participantsDetails.push({
                    gameName: pGameName,
                    tagLine: pTagLine,
                    region: region, // Assume all players are from the same region as the user
                    puuid: pPuuid,
                    profileIconUrl: `https://ddragon.leagueoflegends.com/cdn/${LATEST_PATCH_VERSION}/img/profileicon/${profileIconId}.png`
                });
            }

            res.status(200).json(participantsDetails);

        } catch (error) {
            console.error("[Server] Error in get-last-game-participants:", error);
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    } else {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
};
