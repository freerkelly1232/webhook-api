// ============================================
// COVERAGE WEBHOOK API v2.0
// Clean, fast, no sharing
// ============================================

const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ======== WEBHOOKS ========
const WEBHOOKS = {
  "10m": "https://discord.com/api/webhooks/1444053818278154271/02RKHZ_DafZmvmv6Cr35_llTfIENHXldvXHUdnMPSVP0KQ641SLxAdF3VqFS3bKkBGNp",
  "50m": "https://discord.com/api/webhooks/1444053774468517918/4tPh8KWNfNYOWdDj3CbU687XHtejURQlbOLPuKvUmXxTxhR13z-l6Tx1ESZyDnDA3rp5",
  "100m": "https://discord.com/api/webhooks/1444053732538187808/jAcpkX4Rg6b20bOGaPxmxcRhVCZV-k6Qe65gMpOSK5fHH7HRn5ioqqv4e7AKV-c9yDQc",
  "300m": "https://discord.com/api/webhooks/1444053636543025164/naCk7TbNCtUDJRoV606gJYUBuFwlwThLlSVivfOIdYEyjayY2FEPlxnzNKMm7f_7Eyx1",
  "1b": "https://discord.com/api/webhooks/1444053589923332187/WXwz9yR_IhPtNbdDLgyHDt_M3q9GjSWdvaSicgKL1l8_U7lZ-j94AqfoNnnApqVwtH3H"
};

const ROLE_MENTIONS = {
  "10m": "<@1444362655426023736>",
  "50m": "<@1444362678276591656>",
  "100m": "<@1444362687709450260>",
  "300m": "<@1444362691077738636>",
  "1b": "<@1444362692734353479>"
};

const STATS_WEBHOOK = "https://discord.com/api/webhooks/1444735456167198815/PKzp4YDhYTicTeYa1z15__FaYgWXq9QQVe30Ot9ymfW7MpcVVRbMb5Bsgmpguxj4HEwA";
const STATS_UPDATE_INTERVAL = 10000;
const BOT_TIMEOUT = 120000;

// ======== PRIORITY NAMES ========
const PRIORITY_NAMES = [
  "La Taco Combinasion","La Secret Combinasion","Tang Tang Keletang",
  "Chipso and Queso","Garama and Madundung","La Casa Boo","Tictac Sahur",
  "Spooky and Pumpky","Dragon Cannelloni","Meowl","Strawberry Elephant",
  "Burguro And Fryuro","Ketchuru and Musturu","La Supreme Combinasion",
  "Ketupat Kepat","Capitano Moby","Headless Horseman","Money Money Puggy",
  "Spaghetti Tualetti","Nuclearo Dinossauro","Tralaledon","Los Hotspotsitos",
  "Chillin Chili","Los Primos","Los Tacoritas","Los Spaghettis",
  "Fragrama and Chocrama","Celularcini Viciosini"
];

const TIER_COLORS = {
  "10m": 0x3498db,
  "50m": 0x2ecc71,
  "100m": 0xf1c40f,
  "300m": 0xe67e22,
  "1b": 0xe74c3c
};

// ======== DATA ========
let serverBuffers = {};
let sentMessages = new Set();
let activeBots = {};
let statsMessageId = null;

let logCounts = {
  "10m": 0, "50m": 0, "100m": 0, "300m": 0, "1b": 0, "total": 0
};

// ======== AUTOJOINER (servers with FOUND brainrots) ========
let autoJoinerServers = [];
let autoJoinQueue = [];
let jobBestMap = {};
const AUTOJOINER_MAX_BUFFER = 5000;
const AUTOJOINER_BUFFER_CLEAN_SEC = 120;

// Clean autojoiner buffer periodically
setInterval(() => {
  autoJoinerServers = [];
  console.log("🧹 autoJoinerServers cleared");
}, AUTOJOINER_BUFFER_CLEAN_SEC * 1000);

// ======== CLEANUP ========
setInterval(() => {
  sentMessages.clear();
}, 15 * 60 * 1000);

setInterval(() => {
  const now = Date.now();
  for (const botId in activeBots) {
    if (now - activeBots[botId] > BOT_TIMEOUT) {
      delete activeBots[botId];
    }
  }
}, 30000);

// ======== HELPERS ========
function formatMoney(value) {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B/s`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(0)}M/s`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(0)}K/s`;
  return `$${value}/s`;
}

function getTierLabel(tier) {
  return {"10m": "10M+", "50m": "50M+", "100m": "100M+", "300m": "300M+", "1b": "1B+"}[tier] || tier;
}

async function sendEmbed(webhook, content, embed, key) {
  if (key && sentMessages.has(key)) return;
  if (key) sentMessages.add(key);
  
  if (!webhook || webhook.includes("YOUR_")) return;

  try {
    await fetch(webhook, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({content: content || "", embeds: [embed]})
    });
    console.log(`✅ Sent: ${embed.title}`);
  } catch (err) {
    console.error(`❌ Send error:`, err.message);
  }
}

// ======== STATS EMBED ========
async function updateStatsEmbed() {
  if (!STATS_WEBHOOK || STATS_WEBHOOK.includes("YOUR_")) return;

  const now = new Date();
  const activeBotsCount = Object.keys(activeBots).length;

  const embed = {
    title: "📊 Coverage Bot | Stats",
    color: 0x2b2d31,
    fields: [
      {name: "10M+", value: `\`${logCounts["10m"]}\``, inline: true},
      {name: "50M+", value: `\`${logCounts["50m"]}\``, inline: true},
      {name: "100M+", value: `\`${logCounts["100m"]}\``, inline: true},
      {name: "300M+", value: `\`${logCounts["300m"]}\``, inline: true},
      {name: "1B+", value: `\`${logCounts["1b"]}\``, inline: true},
      {name: "Total", value: `\`${logCounts["total"]}\``, inline: true},
      {name: "Active Bots", value: `\`${activeBotsCount}\``, inline: true},
    ],
    footer: {text: `Updated: ${now.toLocaleTimeString()}`}
  };

  try {
    if (statsMessageId) {
      const parts = STATS_WEBHOOK.split('/');
      await fetch(`https://discord.com/api/webhooks/${parts[parts.length-2]}/${parts[parts.length-1]}/messages/${statsMessageId}`, {
        method: "PATCH",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({embeds: [embed]})
      });
    } else {
      const res = await fetch(`${STATS_WEBHOOK}?wait=true`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({embeds: [embed]})
      });
      const data = await res.json();
      statsMessageId = data.id;
    }
  } catch (err) {
    statsMessageId = null;
  }
}

setInterval(updateStatsEmbed, STATS_UPDATE_INTERVAL);
setTimeout(updateStatsEmbed, 5000);

// ======== SEND LOOP ========
setInterval(async () => {
  for (const jobId in serverBuffers) {
    const buffer = serverBuffers[jobId];
    if (!buffer || buffer.length === 0) continue;

    // Find highest tier
    const has1b = buffer.some(b => b.value >= 1e9);
    const has300 = buffer.some(b => b.value >= 3e8);
    const has100 = buffer.some(b => b.value >= 1e8);
    const has50 = buffer.some(b => b.value >= 5e7);

    let tier = null;
    if (has1b) tier = "1b";
    else if (has300) tier = "300m";
    else if (has100) tier = "100m";
    else if (has50) tier = "50m";
    else tier = "10m";

    // Get brainrots for this tier
    const list = buffer.filter(b => b.value >= 1e7).sort((a, b) => b.value - a.value);
    if (list.length === 0) {
      delete serverBuffers[jobId];
      continue;
    }

    const top = list[0];

    const fields = [
      {name: "Name", value: top.name, inline: true},
      {name: "Money/sec", value: formatMoney(top.value), inline: true},
      {name: "Players", value: `${top.players}/8`, inline: true},
      {name: "Job ID", value: `\`${jobId}\``, inline: false},
      {name: "Join Script", value: `\`\`\`lua\ngame:GetService("TeleportService"):TeleportToPlaceInstance(109983668079237,"${jobId}",game.Players.LocalPlayer)\`\`\``, inline: false}
    ];

    if (list.length > 1) {
      const others = list.slice(1, 5).map(b => `${b.name}: ${formatMoney(b.value)}`).join('\n');
      fields.push({name: "Others", value: `\`\`\`\n${others}\`\`\``, inline: false});
    }

    const embed = {
      title: `Coverage Bot | ${getTierLabel(tier)}`,
      color: TIER_COLORS[tier],
      fields: fields,
      footer: {text: `${Object.keys(activeBots).length} bots scanning`},
      timestamp: new Date().toISOString()
    };

    const key = `${jobId}_${tier}_${list.map(b => b.name).join("_")}`;
    await sendEmbed(WEBHOOKS[tier], ROLE_MENTIONS[tier], embed, key);

    delete serverBuffers[jobId];
  }
}, 500);

// ======== ENDPOINTS ========

app.post("/add-server", (req, res) => {
  try {
    const {jobId, players, brainrots, botId, timestamp} = req.body;

    if (!brainrots || !Array.isArray(brainrots) || !jobId) {
      return res.sendStatus(400);
    }

    if (botId) activeBots[botId] = Date.now();
    if (!serverBuffers[jobId]) serverBuffers[jobId] = [];

    for (const b of brainrots) {
      logCounts.total++;
      if (b.value >= 1e9) logCounts["1b"]++;
      else if (b.value >= 3e8) logCounts["300m"]++;
      else if (b.value >= 1e8) logCounts["100m"]++;
      else if (b.value >= 5e7) logCounts["50m"]++;
      else if (b.value >= 1e7) logCounts["10m"]++;

      // Add to autojoiner buffer (servers with 10M+ finds)
      if (b.value >= 10_000_000 && autoJoinerServers.length < AUTOJOINER_MAX_BUFFER) {
        autoJoinerServers.push({
          jobId,
          numericMPS: b.value,
          name: b.name,
          gen: b.gen,
          players: players || 0,
          brainrots,
          detectedAt: new Date().toISOString()
        });
      }

      serverBuffers[jobId].push({
        name: b.name,
        gen: b.gen,
        value: b.value,
        tier: b.tier,
        players: players || 0
      });

      // Track best per server for autoJoinQueue
      const existing = jobBestMap[jobId];
      if (!existing || b.value > (existing.value || 0)) {
        jobBestMap[jobId] = {
          jobId,
          name: b.name,
          ms: b.gen,
          value: b.value,
          players: players || 0,
          timestamp: Math.floor(Date.now() / 1000)
        };

        if (!autoJoinQueue.some(e => e.jobId === jobId)) {
          autoJoinQueue.push(jobBestMap[jobId]);
        } else {
          autoJoinQueue = autoJoinQueue.map(e => e.jobId === jobId ? jobBestMap[jobId] : e);
        }
      }
    }

    console.log(`📩 ${jobId.substring(0,8)} | ${brainrots.length} brainrots | Bot: ${botId?.substring(0,10) || '-'}`);
    return res.sendStatus(200);
  } catch (err) {
    console.error("Error:", err);
    return res.sendStatus(500);
  }
});

app.post("/heartbeat", (req, res) => {
  const {botId} = req.body;
  if (!botId) return res.status(400).json({error: "missing botId"});
  activeBots[botId] = Date.now();
  return res.json({activeBots: Object.keys(activeBots).length});
});

app.get("/status", (req, res) => {
  res.json({
    activeBots: Object.keys(activeBots).length,
    bufferedServers: Object.keys(serverBuffers).length,
    autoJoinerBuffered: autoJoinerServers.length,
    queuedForAutoJoin: autoJoinQueue.length,
    sentMessagesCacheSize: sentMessages.size,
    logCounts
  });
});

app.get("/active-bots", (req, res) => {
  const bots = Object.entries(activeBots).map(([id, time]) => ({
    id,
    lastSeen: `${Math.floor((Date.now() - time) / 1000)}s ago`
  }));
  res.json({count: bots.length, bots});
});

app.get("/stats", (req, res) => res.json({logCounts, activeBots: Object.keys(activeBots).length}));

app.post("/reset-stats", (req, res) => {
  logCounts = {"10m": 0, "50m": 0, "100m": 0, "300m": 0, "1b": 0, "total": 0};
  res.json({status: "reset"});
});

// ======== AUTOJOINER ENDPOINTS ========

app.get("/Autojoiner", (req, res) => {
  res.json(autoJoinerServers.slice());
});

app.get("/get-server", (req, res) => {
  if (!autoJoinQueue || autoJoinQueue.length === 0) {
    return res.status(404).json({error: "no servers available"});
  }
  const entry = autoJoinQueue.shift();
  if (entry && entry.jobId) delete jobBestMap[entry.jobId];
  return res.json(entry);
});

app.get("/get-servers", (req, res) => {
  res.json({
    job_ids: autoJoinQueue.map(e => ({
      jobId: e.jobId,
      name: e.name,
      ms: e.ms,
      players: e.players
    }))
  });
});

app.post("/remove-server", (req, res) => {
  try {
    const {jobId} = req.body;
    if (!jobId) return res.status(400).json({error: "missing jobId"});

    const beforeList = autoJoinerServers.length;
    autoJoinerServers = autoJoinerServers.filter(s => s.jobId !== jobId);
    const removedFromList = beforeList - autoJoinerServers.length;

    const beforeQueue = autoJoinQueue.length;
    autoJoinQueue = autoJoinQueue.filter(s => s.jobId !== jobId);
    const removedFromQueue = beforeQueue - autoJoinQueue.length;

    if (jobBestMap[jobId]) delete jobBestMap[jobId];

    console.log(`🗑️ Removed ${jobId.substring(0,8)}... | List: -${removedFromList} | Queue: -${removedFromQueue}`);
    return res.json({success: true, removed: removedFromList + removedFromQueue});
  } catch (err) {
    console.error("remove-server error:", err);
    return res.sendStatus(500);
  }
});

app.post("/add-pool", (req, res) => {
  const data = req.body;
  if (!data || !Array.isArray(data.servers)) {
    return res.status(400).json({error: "missing 'servers' array"});
  }

  let added = 0;

  for (const j of data.servers) {
    if (!j) continue;

    if (!jobBestMap[j] && !autoJoinQueue.some(e => e.jobId === j)) {
      const entry = {
        jobId: j,
        name: null,
        ms: null,
        value: 0,
        players: 0,
        timestamp: Math.floor(Date.now() / 1000)
      };
      jobBestMap[j] = entry;
      autoJoinQueue.push(entry);
      added++;
    }
  }

  return res.json({added});
});

// ======== START ========
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   COVERAGE WEBHOOK API v2.0           ║
║   Clean • Fast • No Sharing           ║
║   Port: ${PORT}                          ║
╚═══════════════════════════════════════╝
  `);
});
