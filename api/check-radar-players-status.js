/*
* ======================================
* FILE: api/check-radar-players-status.js
* ======================================
* NEW FILE. Handles the "Activate Radar" button.
* This is a "lighter" check. It only checks if players are in a game.
*/

const fetch = require('node-fetch');

// --- CONFIGURATION ---
const RIOT_API_KEY = process.env.RIOT_API_KEY; 
const DELAY_BETWEEN_PLAYERS = 500; // Can be faster, less data
// ---------------------

// --- HELPER FUNCTIONS (Copied from check-status.js) ---
const delay = ms => new Promise(res => setTimeout(res, ms));

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

const authenticatedFetch = async (url) => {
    if (!RIOT_API_KEY) {
        console.error("[Server Error] RIOT_API_KEY environment variable is not set.");
        return { ok: false, status: 500, statusText: 'Server Configuration Error' };
    }
    const response = await fetch(url, { headers: { "X-Riot-Token": RIOT_API_KEY } });
    console.log(`[API Response] Status: ${response.status} for URL: ${url}`);
    return response;
};
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
            const { players } = req.body; // Expects [{ puuid, region }, ...]
            if (!players || !Array.isArray(players)) {
                return res.status(400).json({ error: 'Invalid player list format.' });
            }

            const statuses = [];

            for (const player of players) {
                const platform = getPlatformUrl(player.region);
                if (!platform) {
                    statuses.push({ puuid: player.puuid, status: 'ERROR' });
                    continue; // Skip if region is invalid
                }

                const spectatorURL = `https://${platform}/lol/spectator/v5/active-games/by-summoner/${player.puuid}`;
                const liveGameResponse = await authenticatedFetch(spectatorURL);

                if (liveGameResponse.ok) {
                    // Player is in a game
                    statuses.push({ puuid: player.puuid, status: 'IN_GAME' });
                } else if (liveGameResponse.status === 404) {
                    // Player is not in a game
                    statuses.push({ puuid: player.puuid, status: 'NOT_IN_GAME' });
                } else if (liveGameResponse.status === 500) {
                     // Server key error
                    statuses.push({ puuid: player.puuid, status: 'ERROR' });
                } else {
                    // Other error (e.g., 403, 429)
                    statuses.push({ puuid: player.puuid, status: 'ERROR' });
                }
                
                await delay(DELAY_BETWEEN_PLAYERS); // Rate limit
            }

            res.status(200).json(statuses);

        } catch (error) {
            console.error("[Server] Error in check-radar-players-status:", error);
            res.status(500).json({ error: 'An internal server error occurred.' });
        }
    } else {
        res.setHeader('Allow', ['POST', 'OPTIONS']);
        res.status(405).json({ error: `Method ${req.method} Not Allowed` });
    }
};
