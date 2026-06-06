// ─────────────────────────────────────────────────────────────
// sync.js — Auto-sync World Cup 2026 results from api-sports.io
// Runs every 5 minutes, only fetches finished matches
// World Cup 2026 league ID = 1 in api-sports
// ─────────────────────────────────────────────────────────────

const https = require('https');

// Match ID mapping: api-sports fixture_id → our internal match id
// We match by home+away team names after normalizing
const TEAM_MAP = {
  // api-sports name → our name
  "Mexico":               "México",
  "South Africa":         "Sudáfrica",
  "South Korea":          "Corea del Sur",
  "Czech Republic":       "Rep. Checa",
  "Canada":               "Canadá",
  "Bosnia":               "Bosnia y Herz.",
  "Qatar":                "Qatar",
  "Switzerland":          "Suiza",
  "Brazil":               "Brasil",
  "Morocco":              "Marruecos",
  "Haiti":                "Haití",
  "Scotland":             "Escocia",
  "United States":        "Estados Unidos",
  "USA":                  "Estados Unidos",
  "Paraguay":             "Paraguay",
  "Australia":            "Australia",
  "Turkey":               "Turquía",
  "Germany":              "Alemania",
  "Curacao":              "Curazao",
  "Ivory Coast":          "Costa de Marfil",
  "Ecuador":              "Ecuador",
  "Netherlands":          "Países Bajos",
  "Japan":                "Japón",
  "Sweden":               "Suecia",
  "Tunisia":              "Túnez",
  "Belgium":              "Bélgica",
  "Egypt":                "Egipto",
  "Iran":                 "Irán",
  "New Zealand":          "Nueva Zelanda",
  "Spain":                "España",
  "Cape Verde":           "Cabo Verde",
  "Saudi Arabia":         "Arabia Saudita",
  "Uruguay":              "Uruguay",
  "France":               "Francia",
  "Senegal":              "Senegal",
  "Iraq":                 "Irak",
  "Norway":               "Noruega",
  "Argentina":            "Argentina",
  "Algeria":              "Argelia",
  "Austria":              "Austria",
  "Jordan":               "Jordania",
  "Portugal":             "Portugal",
  "DR Congo":             "RD del Congo",
  "Uzbekistan":           "Uzbekistán",
  "Colombia":             "Colombia",
  "England":              "Inglaterra",
  "Croatia":              "Croacia",
  "Ghana":                "Ghana",
  "Panama":               "Panamá",
};

// Our full fixture (home, away, internal id)
const FIXTURE = [
  {id:1,home:"México",away:"Sudáfrica"},{id:2,home:"Corea del Sur",away:"Rep. Checa"},
  {id:3,home:"Rep. Checa",away:"Sudáfrica"},{id:4,home:"México",away:"Corea del Sur"},
  {id:5,home:"Sudáfrica",away:"Corea del Sur"},{id:6,home:"Rep. Checa",away:"México"},
  {id:7,home:"Canadá",away:"Bosnia y Herz."},{id:8,home:"Qatar",away:"Suiza"},
  {id:9,home:"Suiza",away:"Bosnia y Herz."},{id:10,home:"Canadá",away:"Qatar"},
  {id:11,home:"Suiza",away:"Canadá"},{id:12,home:"Bosnia y Herz.",away:"Qatar"},
  {id:13,home:"Brasil",away:"Marruecos"},{id:14,home:"Haití",away:"Escocia"},
  {id:15,home:"Escocia",away:"Marruecos"},{id:16,home:"Brasil",away:"Haití"},
  {id:17,home:"Marruecos",away:"Haití"},{id:18,home:"Brasil",away:"Escocia"},
  {id:19,home:"Estados Unidos",away:"Paraguay"},{id:20,home:"Australia",away:"Turquía"},
  {id:21,home:"Estados Unidos",away:"Australia"},{id:22,home:"Turquía",away:"Paraguay"},
  {id:23,home:"Paraguay",away:"Australia"},{id:24,home:"Turquía",away:"Estados Unidos"},
  {id:25,home:"Alemania",away:"Curazao"},{id:26,home:"Costa de Marfil",away:"Ecuador"},
  {id:27,home:"Alemania",away:"Costa de Marfil"},{id:28,home:"Ecuador",away:"Curazao"},
  {id:29,home:"Curazao",away:"Costa de Marfil"},{id:30,home:"Ecuador",away:"Alemania"},
  {id:31,home:"Países Bajos",away:"Japón"},{id:32,home:"Suecia",away:"Túnez"},
  {id:33,home:"Países Bajos",away:"Suecia"},{id:34,home:"Túnez",away:"Japón"},
  {id:35,home:"Japón",away:"Suecia"},{id:36,home:"Túnez",away:"Países Bajos"},
  {id:37,home:"Bélgica",away:"Egipto"},{id:38,home:"Irán",away:"Nueva Zelanda"},
  {id:39,home:"Bélgica",away:"Irán"},{id:40,home:"Nueva Zelanda",away:"Egipto"},
  {id:41,home:"Egipto",away:"Irán"},{id:42,home:"Nueva Zelanda",away:"Bélgica"},
  {id:43,home:"España",away:"Cabo Verde"},{id:44,home:"Arabia Saudita",away:"Uruguay"},
  {id:45,home:"España",away:"Arabia Saudita"},{id:46,home:"Uruguay",away:"Cabo Verde"},
  {id:47,home:"Cabo Verde",away:"Arabia Saudita"},{id:48,home:"Uruguay",away:"España"},
  {id:49,home:"Francia",away:"Senegal"},{id:50,home:"Irak",away:"Noruega"},
  {id:51,home:"Francia",away:"Irak"},{id:52,home:"Noruega",away:"Senegal"},
  {id:53,home:"Noruega",away:"Francia"},{id:54,home:"Senegal",away:"Irak"},
  {id:55,home:"Argentina",away:"Argelia"},{id:56,home:"Austria",away:"Jordania"},
  {id:57,home:"Argentina",away:"Austria"},{id:58,home:"Jordania",away:"Argelia"},
  {id:59,home:"Argelia",away:"Austria"},{id:60,home:"Jordania",away:"Argentina"},
  {id:61,home:"Portugal",away:"RD del Congo"},{id:62,home:"Uzbekistán",away:"Colombia"},
  {id:63,home:"Portugal",away:"Uzbekistán"},{id:64,home:"Colombia",away:"RD del Congo"},
  {id:65,home:"Colombia",away:"Portugal"},{id:66,home:"RD del Congo",away:"Uzbekistán"},
  {id:67,home:"Inglaterra",away:"Croacia"},{id:68,home:"Ghana",away:"Panamá"},
  {id:69,home:"Inglaterra",away:"Ghana"},{id:70,home:"Panamá",away:"Croacia"},
  {id:71,home:"Croacia",away:"Ghana"},{id:72,home:"Panamá",away:"Inglaterra"},
];

function normalizeTeam(name) {
  if (!name) return '';
  return TEAM_MAP[name] || name;
}

function findMatchId(homeApi, awayApi) {
  const h = normalizeTeam(homeApi);
  const a = normalizeTeam(awayApi);
  const match = FIXTURE.find(m =>
    (m.home === h && m.away === a) ||
    (m.home === a && m.away === h)
  );
  return match ? { id: match.id, swapped: match.home === a } : null;
}

function apiRequest(path, apiKey) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'v3.football.api-sports.io',
      path,
      method: 'GET',
      headers: {
        'x-apisports-key': apiKey,
      }
    };
    let data = '';
    const req = https.request(options, res => {
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Main sync function — called from server.js
async function syncResults(db, dbRun, dbGet, apiKey) {
  console.log('🔄 Syncing results from api-sports...');
  try {
    // World Cup 2026 = league 1, season 2026
    const data = await apiRequest('/fixtures?league=1&season=2026&status=FT', apiKey);

    if (!data.response || !Array.isArray(data.response)) {
      console.log('⚠️  api-sports: unexpected response', JSON.stringify(data).slice(0,200));
      return 0;
    }

    let updated = 0;
    for (const fixture of data.response) {
      const homeApi = fixture.teams?.home?.name;
      const awayApi = fixture.teams?.away?.name;
      const homeGoals = fixture.goals?.home;
      const awayGoals = fixture.goals?.away;

      if (homeGoals === null || awayGoals === null) continue;

      const found = findMatchId(homeApi, awayApi);
      if (!found) {
        console.log(`  ⚠️  No match for: ${homeApi} vs ${awayApi}`);
        continue;
      }

      const { id: matchId, swapped } = found;
      const h = swapped ? awayGoals : homeGoals;
      const a = swapped ? homeGoals : awayGoals;

      const existing = dbGet('SELECT match_id, home_goals, away_goals FROM results WHERE match_id=?', [matchId]);
      if (existing && existing.home_goals === h && existing.away_goals === a) continue; // no change

      if (existing) {
        db.run('UPDATE results SET home_goals=?,away_goals=?,saved_at=datetime("now") WHERE match_id=?', [h, a, matchId]);
      } else {
        db.run('INSERT INTO results (match_id,home_goals,away_goals) VALUES (?,?,?)', [matchId, h, a]);
      }
      console.log(`  ✓ Match ${matchId}: ${homeApi} ${h}-${a} ${awayApi}`);
      updated++;
    }

    console.log(`✅ Sync complete: ${updated} results updated, ${data.response.length} finished matches found`);
    return updated;
  } catch(err) {
    console.error('❌ Sync error:', err.message);
    return 0;
  }
}

module.exports = { syncResults };
