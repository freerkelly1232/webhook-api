// server.js
const express = require("express");
const fetch = require("node-fetch"); // node-fetch@2
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ======== CONFIG ========
const AUTOJOINER_KEY = "your-autojoiner-key-here";
const AUTOJOINER_BUFFER_CLEAN_SEC = 120;
const SERVER_FETCH_LIMIT = 100;
const SERVER_FETCH_INTERVAL = 15000;

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

const HIGHLIGHT_WEBHOOK = "https://discord.com/api/webhooks/1441848571983953951/bZWTcN8pbV06-T8dELQG9y2AVV8SPl6xhYzI4nH9iCkHhGBUREHjWQvao82j9GnvHRaZ";

// ======== STATS WEBHOOK ========
const STATS_WEBHOOK = "https://discord.com/api/webhooks/1444735456167198815/PKzp4YDhYTicTeYa1z15__FaYgWXq9QQVe30Ot9ymfW7MpcVVRbMb5Bsgmpguxj4HEwA";
const STATS_UPDATE_INTERVAL = 10000; // Update every 10 seconds
const BOT_TIMEOUT = 120000; // 2 minutes

// Store the stats message ID to edit it
let statsMessageId = null;

// ======== PRIORITY NAMES ======
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

const BRAINROT_THUMBNAILS = {
  "Strawberry Elephant": "your-thumbnail-url-here",
  "Meowl": "your-thumbnail-url-here",
  "Dragon Cannelloni": "your-thumbnail-url-here",
};

const TIER_COLORS = {
  "10m": 0x2b2d31,
  "50m": 0x2b2d31,
  "100m": 0x2b2d31,
  "300m": 0x2b2d31,
  "1b": 0x2b2d31
};

// ======== IN-MEMORY STRUCTURES ========
let serverBuffers = {};
let highlightBuffer = [];
let sentMessages = new Set();
let autoJoinQueue = [];
let jobBestMap = {};
let autoJoinerServers = [];
const AUTOJOINER_MAX_BUFFER = 5000;

// ======== STATS TRACKING ========
let logCounts = {
  "10m": 0,
  "50m": 0,
  "100m": 0,
  "300m": 0,
  "1b": 0,
  "total": 0
};
let activeBots = {}; // { botId: lastHeartbeat timestamp }

// ======== CLEANUP INTERVALS ========
setInterval(() => { sentMessages.clear(); console.log("🧹 Duplicate cache cleared"); }, 15*60*1000);
setInterval(() => { autoJoinerServers = []; console.log(`🧹 autoJoinerServers cleared`); }, AUTOJOINER_BUFFER_CLEAN_SEC*1000);

// ======== BOT CLEANUP ========
setInterval(() => {
  const now = Date.now();
  for (const botId in activeBots) {
    if (now - activeBots[botId] > BOT_TIMEOUT) {
      delete activeBots[botId];
    }
  }
}, 30000);

// ======== STATS EMBED - EDIT SINGLE MESSAGE ========
async function updateStatsEmbed() {
  if (!STATS_WEBHOOK) return;

  const now = new Date();
  const timeString = now.toLocaleTimeString("en-US", { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateString = now.toLocaleDateString("en-US", { month: 'short', day: 'numeric', year: 'numeric' });

  const activeBotsCount = Object.keys(activeBots).length;

  // Clean embed design matching the image
  const statsEmbed = {
    title: "📊 Xen Notifier | Stats",
    color: 0x2b2d31,
    fields: [
      { name: "10M+", value: `🔵 \`${logCounts["10m"].toLocaleString()}\``, inline: true },
      { name: "50M+", value: `🟢 \`${logCounts["50m"].toLocaleString()}\``, inline: true },
      { name: "100M+", value: `🟡 \`${logCounts["100m"].toLocaleString()}\``, inline: true },
      { name: "300M+", value: `🟠 \`${logCounts["300m"].toLocaleString()}\``, inline: true },
      { name: "1B+", value: `🔴 \`${logCounts["1b"].toLocaleString()}\``, inline: true },
      { name: "Total", value: `⚪ \`${logCounts["total"].toLocaleString()}\``, inline: true },
      { name: "Active Bots", value: `🤖 \`${activeBotsCount}\``, inline: true },
    ],
    footer: { text: `Last updated: ${timeString} • ${dateString}` }
  };

  try {
    if (statsMessageId) {
      // Edit existing message
      const webhookParts = STATS_WEBHOOK.split('/');
      const webhookId = webhookParts[webhookParts.length - 2];
      const webhookToken = webhookParts[webhookParts.length - 1];
      
      await fetch(`https://discord.com/api/webhooks/${webhookId}/${webhookToken}/messages/${statsMessageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [statsEmbed] })
      });
      console.log(`📊 Stats updated`);
    } else {
      // Create new message and store ID
      const response = await fetch(`${STATS_WEBHOOK}?wait=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [statsEmbed] })
      });
      const data = await response.json();
      statsMessageId = data.id;
      console.log(`📊 Stats message created: ${statsMessageId}`);
    }
  } catch (err) {
    console.error("❌ Stats error:", err);
    // Reset message ID if edit fails, will create new one
    statsMessageId = null;
  }
}

// Update stats every 10 seconds
setInterval(updateStatsEmbed, STATS_UPDATE_INTERVAL);

// Initial stats post after 5 seconds
setTimeout(updateStatsEmbed, 5000);

// ======== HELPERS ========
function formatMoney(value) {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B/s`;
  } else if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(0)}M/s`;
  } else if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(0)}K/s`;
  }
  return `$${value}/s`;
}

function formatMoneyDetailed(value) {
  return `$${value.toLocaleString()}/s`;
}

async function sendEmbed(webhook, content, embed, uniqueKey) {
  const now = new Date().toLocaleTimeString("en-US",{hour12:false});
  if(uniqueKey && sentMessages.has(uniqueKey)){
    console.log(`[${now}] ⚠️ Duplicate ignored: ${uniqueKey}`);
    return;
  }
  if(uniqueKey) sentMessages.add(uniqueKey);

  try {
    await fetch(webhook,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ content: content || "", embeds:[embed] })
    });
    console.log(`[${now}] ✅ Sent: ${embed.title} (${uniqueKey||"no-key"})`);
  } catch(err){
    console.error(`[${now}] ❌ Error:`, err);
  }
}

function getPriorityBrainrot(brainrots){
  if(!brainrots || brainrots.length===0) return null;
  const list = brainrots.filter(b => PRIORITY_NAMES.includes(b.name));
  if(list.length===0) return null;
  list.sort((a,b)=>b.value-a.value);
  return list[0];
}

function getThumbnail(brainrots){
  if(!brainrots || brainrots.length===0) return null;
  const priority = getPriorityBrainrot(brainrots);
  if(priority && BRAINROT_THUMBNAILS[priority.name]) return BRAINROT_THUMBNAILS[priority.name];

  const withThumb = brainrots.filter(b=>BRAINROT_THUMBNAILS[b.name]);
  if(withThumb.length===0) return null;
  withThumb.sort((a,b)=>b.value-a.value);
  return BRAINROT_THUMBNAILS[withThumb[0].name];
}

function getTierLabel(tier) {
  const labels = {
    "10m": "10M+",
    "50m": "50M+",
    "100m": "100M+",
    "300m": "300M+",
    "1b": "1B+"
  };
  return labels[tier] || tier.toUpperCase();
}

// ======== SENDER LOOP ========
setInterval(async ()=>{
  const promises = [];

  for(const jobId in serverBuffers){
    const buffer = serverBuffers[jobId];
    if(!buffer || buffer.length===0) continue;

    const has1b  = buffer.some(b=>b.value>=1_000_000_000);
    const has300 = buffer.some(b=>b.value>=300_000_000);
    const has100 = buffer.some(b=>b.value>=100_000_000);
    const has50  = buffer.some(b=>b.value>=50_000_000);

    let targetTier = null;
    if(has1b) targetTier = "1b";
    else if(has300) targetTier = "300m";
    else if(has100) targetTier = "100m";
    else if(has50)  targetTier = "50m";

    let tiersToSend = { "10m": [], "50m": [], "100m": [], "300m": [], "1b": [] };

    if(targetTier){
      tiersToSend[targetTier] = buffer.filter(b=>b.value>=10_000_000);
    } else {
      for(const b of buffer){
        if(tiersToSend[b.tier]) tiersToSend[b.tier].push(b);
      }
    }

    for(const tierKey in tiersToSend){
      const list = tiersToSend[tierKey];
      if(!list || list.length===0) continue;

      list.sort((a,b)=>b.value-a.value);

      const topBrainrot = list[0];
      const totalMoney = formatMoney(topBrainrot.value);

      const fields = [];

      fields.push({
        name: "Name",
        value: topBrainrot.name,
        inline: true
      });

      fields.push({
        name: "Money/sec",
        value: totalMoney,
        inline: true
      });

      fields.push({
        name: "Players",
        value: `${topBrainrot.players}/8`,
        inline: true
      });

      fields.push({
        name: "Job ID (Mobile)",
        value: `\`${jobId}\``,
        inline: false
      });

      const joinScript = `game:GetService("TeleportService"):TeleportToPlaceInstance(109983668079237,"${jobId}",game.Players.LocalPlayer)`;
      fields.push({
        name: "Join Script (PC)",
        value: `\`\`\`lua\n${joinScript}\`\`\``,
        inline: false
      });

      if(list.length > 1) {
        const othersLines = list.slice(1).map(b => `1x ${b.name} : ${formatMoneyDetailed(b.value)}`);
        fields.push({
          name: "Others",
          value: `\`\`\`\n${othersLines.join('\n')}\`\`\``,
          inline: false
        });
      }

      const embed = {
        title: `Xen Notifier | ${getTierLabel(tierKey)}`,
        color: TIER_COLORS[tierKey] || 0x2b2d31,
        fields: fields,
        footer: { text: `Xen Notifier` },
        timestamp: new Date().toISOString()
      };

      const thumb = getThumbnail(list);
      if(thumb) embed.thumbnail = { url: thumb };

      const namesKey = list.map(b=>`${b.name}-${b.gen}`).sort().join("_");
      const key = `main_${jobId}_${targetTier||tierKey}_${namesKey}`;

      promises.push(sendEmbed(WEBHOOKS[targetTier||tierKey], ROLE_MENTIONS[targetTier||tierKey], embed, key));
    }

    // ======== HIGHLIGHT EMBED ========
    const seen = new Set();
    const unique = [];

    for(const b of buffer){
      if(b.value < 50_000_000) continue;
      const k = `${b.serverId}_${b.name}_${b.gen}`;
      if(seen.has(k)) continue;
      seen.add(k);
      unique.push(b);
    }

    if(unique.length > 0 && HIGHLIGHT_WEBHOOK){
      unique.sort((a,b)=>b.value-a.value);
      const top = unique[0];

      const totalHighlightMoney = formatMoney(top.value);
      
      const highlightFields = [];

      highlightFields.push({
        name: "Name",
        value: top.name,
        inline: true
      });

      highlightFields.push({
        name: "Money/sec",
        value: totalHighlightMoney,
        inline: true
      });

      highlightFields.push({
        name: "Players",
        value: `${top.players}/8`,
        inline: true
      });

      if(unique.length > 1) {
        const othersLines = unique.slice(1).map(b => `1x ${b.name} : ${formatMoneyDetailed(b.value)}`);
        highlightFields.push({
          name: "Others",
          value: `\`\`\`\n${othersLines.join('\n')}\`\`\``,
          inline: false
        });
      }

      const highlightEmbed = {
        title: `Xen Notifier | Highlight`,
        color: 0xFFD700,
        fields: highlightFields,
        footer: { text: `Xen Notifier` },
        timestamp: new Date().toISOString()
      };

      const thumbH = getThumbnail(unique);
      if(thumbH) highlightEmbed.thumbnail = { url: thumbH };

      const highlightKey = `highlight_${jobId}_${unique.map(b=>`${b.name}-${b.gen}`).sort().join("_")}`;
      promises.push(sendEmbed(HIGHLIGHT_WEBHOOK, "", highlightEmbed, highlightKey));
    }

    delete serverBuffers[jobId];
  }

  await Promise.all(promises);

}, 500);

// ======== ENDPOINTS ========

app.post("/add-server",(req,res)=>{
  try{
    const {jobId,players,brainrots,timestamp,botId} = req.body;

    if(!brainrots || !Array.isArray(brainrots) || brainrots.length===0)
      return res.sendStatus(400);

    if(!jobId) return res.status(400).json({error:"missing jobId"});

    // Update bot heartbeat if botId provided
    if(botId) {
      activeBots[botId] = Date.now();
    }

    if(!serverBuffers[jobId]) serverBuffers[jobId] = [];

    for(let b of brainrots){
      let tier = (b.tier || "").toLowerCase();

      // Count logs by tier
      logCounts["total"]++;
      if(b.value >= 1_000_000_000) logCounts["1b"]++;
      else if(b.value >= 300_000_000) logCounts["300m"]++;
      else if(b.value >= 100_000_000) logCounts["100m"]++;
      else if(b.value >= 50_000_000) logCounts["50m"]++;
      else if(b.value >= 10_000_000) logCounts["10m"]++;

      if(b.value >= 10_000_000 && autoJoinerServers.length < AUTOJOINER_MAX_BUFFER){
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
        serverId: jobId,
        name: b.name,
        gen: b.gen,
        value: b.value,
        tier: tier,
        players: players || 0,
        timestamp: Math.floor(Date.now()/1000)
      });

      if(tier && WEBHOOKS[tier] && b.value >= 50_000_000)
        highlightBuffer.push(b);

      const existing = jobBestMap[jobId];
      if(!existing || b.value > (existing.value || 0)){
        jobBestMap[jobId] = {
          jobId,
          name: b.name,
          ms: b.gen,
          value: b.value,
          players: players || 0,
          timestamp: Math.floor(Date.now()/1000)
        };

        if(!autoJoinQueue.some(e => e.jobId === jobId))
          autoJoinQueue.push(jobBestMap[jobId]);
        else
          autoJoinQueue = autoJoinQueue.map(e => e.jobId === jobId ? jobBestMap[jobId] : e);
      }
    }

    console.log(`📩 Received ${jobId} | ${brainrots.length} brainrots | ${players} players | bot: ${botId || 'none'}`);
    return res.sendStatus(200);

  } catch(err){
    console.error("add-server error:", err);
    return res.sendStatus(500);
  }
});

// AutoJoiner
app.get("/Autojoiner",(req,res)=>res.json(autoJoinerServers.slice()));
app.get("/get-server",(req,res)=>{
  if(!autoJoinQueue || autoJoinQueue.length===0)
    return res.status(404).json({error:"no servers available"});
  const entry = autoJoinQueue.shift();
  if(entry && entry.jobId) delete jobBestMap[entry.jobId];
  return res.json(entry);
});
app.get("/get-servers",(req,res)=>res.json({
  job_ids: autoJoinQueue.map(e=>({
    jobId:e.jobId,
    name:e.name,
    ms:e.ms,
    players:e.players
  }))
}));

// Status page
app.get("/status",(req,res)=>res.json({
  serverBuffers:Object.keys(serverBuffers).length,
  highlightBuffered:highlightBuffer.length,
  queuedForAutoJoin:autoJoinQueue.length,
  sentMessagesCacheSize:sentMessages.size,
  autoJoinerBuffered:autoJoinerServers.length,
  activeBots: Object.keys(activeBots).length,
  botList: Object.keys(activeBots),
  logCounts: logCounts
}));

// Bot heartbeat - bots call this to register as active
app.post("/heartbeat", (req, res) => {
  const { botId } = req.body;
  if (!botId) return res.status(400).json({ error: "missing botId" });
  
  activeBots[botId] = Date.now();
  console.log(`💓 Heartbeat from bot: ${botId}`);
  return res.json({ status: "ok", activeBots: Object.keys(activeBots).length });
});

// Get stats
app.get("/stats", (req, res) => {
  return res.json({
    logCounts: logCounts,
    activeBots: Object.keys(activeBots).length,
    botList: Object.keys(activeBots)
  });
});

// Reset stats
app.post("/reset-stats", (req, res) => {
  logCounts = { "10m": 0, "50m": 0, "100m": 0, "300m": 0, "1b": 0, "total": 0 };
  console.log("📊 Stats reset");
  return res.json({ status: "stats reset" });
});

// Add pool
app.post("/add-pool",(req,res)=>{
  const data = req.body;
  if(!data || !Array.isArray(data.servers))
    return res.status(400).json({error:"missing 'servers' array"});

  let added = 0;

  for(const j of data.servers){
    if(!j) continue;

    if(!jobBestMap[j] && !autoJoinQueue.some(e => e.jobId === j)){
      const entry = {
        jobId: j,
        name: null,
        ms: null,
        value: 0,
        players: 0,
        timestamp: Math.floor(Date.now()/1000)
      };
      jobBestMap[j] = entry;
      autoJoinQueue.push(entry);
      added++;
    }
  }

  return res.json({added});
});

// ======== START SERVER ========
app.listen(PORT,()=>console.log(`✅ Xen Notifier API is running on port ${PORT}`));
