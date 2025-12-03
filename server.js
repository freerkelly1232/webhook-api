// server.js - OPTIMIZED Discord Notifier
// Features:
// - Batched webhook sending (avoids rate limits)
// - Efficient deduplication with LRU cache
// - Priority queue for best servers
// - Memory-efficient buffer management

const express = require("express");
const fetch = require("node-fetch");
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;

// ======== CONFIG ========
const AUTOJOINER_KEY = process.env.AUTOJOINER_KEY || "your-autojoiner-key-here";
const AUTOJOINER_BUFFER_CLEAN_SEC = 120;
const MAX_BUFFER_SIZE = 5000;
const WEBHOOK_BATCH_DELAY_MS = 600;  // Delay between webhook sends
const DEDUP_CACHE_SIZE = 10000;       // LRU cache size
const DEDUP_CACHE_TTL_MS = 900000;    // 15 minutes

// ======== WEBHOOKS ========
const WEBHOOKS = {
  "10m": "https://discord.com/api/webhooks/1445565930104029205/k897On-Kq-djxkDsbYCL5YjXrSwaupxOzYEEFV6rMOL0CgzW-4VNa_zzSbqPFkLzfZmw",
  "50m": "https://discord.com/api/webhooks/1445565848973738086/ACqfk93B5u20N9stfnKaLns0eQhZ5LXkDYwCWeb0UYr9hvvFeAj6GwVYXeuTWfMFgIvr",
  "100m": "https://discord.com/api/webhooks/1445565737640136875/4OCEo_3LuuQf7JrqWSvNSEnHfjZ1PpisEV-v1M6qPifwxnCEAF5b84zbI5rlEZMVCdRB",
  "300m": "https://discord.com/api/webhooks/1445565671953010906/mfQb-npQF4az9t-Zb7CqHULcEUqvIvXSskQp7JYy4mKdFl3xicQkTgUJd5nnZ4w1uI9P",
  "1b": "https://discord.com/api/webhooks/1445565590508142733/Q9bBllVQZKREkpH9_t4YEwVrOgXwOzftXRDnwRXyIvWDyCX4GDedfmyU7nvmss1dN0lB"
};

const ROLE_MENTIONS = {
  "10m": process.env.ROLE_10M || "",
  "50m": process.env.ROLE_50M || "",
  "100m": process.env.ROLE_100M || "",
  "300m": process.env.ROLE_300M || "",
  "1b": process.env.ROLE_1B || ""
};

const HIGHLIGHT_WEBHOOK = "https://discord.com/api/webhooks/1445566011767259257/jupLICUBkOa6OkYF4TY_b7gZ47NuEmGpHnZVMdW9jw7lUivYQlpYH1LOColrpZBBpgTe";

// Bot stats webhook - shows active bot count
const BOT_STATS_WEBHOOK = "https://discord.com/api/webhooks/1445616403087495302/gNtvYYzBSvouwV0D0oGa7gjGWhAcJ6QvEbgsS838oJ8wOvvwoQO46IgdCK3tGIUuiZ0f";
const BOT_STATS_INTERVAL_MS = 60000;  // Update every 60 seconds

// ======== PRIORITY NAMES ========
const PRIORITY_NAMES = new Set([
  "La Taco Combinasion","La Secret Combinasion","Tang Tang Keletang",
  "Chipso and Queso","Garama and Madundung","La Casa Boo","Tictac Sahur",
  "Spooky and Pumpky","Dragon Cannelloni","Meowl","Strawberry Elephant",
  "Burguro And Fryuro","Ketchuru and Musturu","La Supreme Combinasion",
  "Ketupat Kepat","Capitano Moby","Headless Horseman","Money Money Puggy",
  "Spaghetti Tualetti","Nuclearo Dinossauro","Tralaledon","Los Hotspotsitos",
  "Chillin Chili","Los Primos","Los Tacoritas","Los Spaghettis",
  "Fragrama and Chocrama","Celularcini Viciosini","Gobblino Uniciclino"
]);

// ======== HIGHLIGHT PRIORITY NAMES (always show in highlights) ========
const HIGHLIGHT_PRIORITY_NAMES = new Set([
  "La Taco Combinasion","La Secret Combinasion","Tang Tang Keletang",
  "Chipso and Queso","Garama and Madundung","Garama And Madundung","La Casa Boo","Tictac Sahur",
  "Spooky and Pumpky","Dragon Cannelloni","Meowl","Strawberry Elephant",
  "Burguro And Fryuro","Ketchuru and Musturu","La Supreme Combinasion",
  "Ketupat Kepat","Capitano Moby","Headless Horseman","Money Money Puggy",
  "Spaghetti Tualetti","Nuclearo Dinossauro","Tralaledon","Los Hotspotsitos",
  "Chillin Chili","Los Primos","Los Tacoritas","Los Spaghettis",
  "Fragrama and Chocrama","Celularcini Viciosini","Gobblino Uniciclino"
]);

// ======== LRU CACHE FOR DEDUPLICATION ========
class LRUCache {
  constructor(maxSize, ttlMs) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return false;
    }
    // Move to end (most recent)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return true;
  }

  add(key) {
    if (this.cache.size >= this.maxSize) {
      // Remove oldest entry
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { expiry: Date.now() + this.ttlMs });
  }

  size() {
    return this.cache.size;
  }

  clear() {
    this.cache.clear();
  }
}

// ======== STATE ========
const sentMessages = new LRUCache(DEDUP_CACHE_SIZE, DEDUP_CACHE_TTL_MS);
const serverBuffers = new Map();  // jobId -> brainrots[]
const autoJoinerServers = [];
const webhookQueue = [];
let isProcessingQueue = false;

// ======== SCRIPT USER TRACKING ========
const scriptUsers = new Map();  // jobId -> Map<userId, {username, timestamp}>
const SCRIPT_USER_TIMEOUT_MS = 30000;  // 30 seconds timeout

// ======== ACTIVE BOT TRACKING ========
const activeBots = new Map();  // botId -> { lastSeen: timestamp, name: string }
const BOT_ACTIVE_TIMEOUT_MS = 120000;  // 2 minutes - bot considered inactive after this

function trackBot(botId) {
  if (!botId || botId === "Unknown") return;
  activeBots.set(botId, {
    lastSeen: Date.now(),
    name: botId
  });
}

function getActiveBotCount() {
  const now = Date.now();
  let count = 0;
  for (const [botId, data] of activeBots.entries()) {
    if (now - data.lastSeen < BOT_ACTIVE_TIMEOUT_MS) {
      count++;
    } else {
      activeBots.delete(botId);  // Clean up inactive
    }
  }
  return count;
}

function getActiveBotsList() {
  const now = Date.now();
  const active = [];
  for (const [botId, data] of activeBots.entries()) {
    if (now - data.lastSeen < BOT_ACTIVE_TIMEOUT_MS) {
      active.push(botId);
    }
  }
  return active;
}

// ======== HELPERS ========
function getTierFromValue(value) {
  if (value >= 1_000_000_000) return "1b";
  if (value >= 300_000_000) return "300m";
  if (value >= 100_000_000) return "100m";
  if (value >= 50_000_000) return "50m";
  if (value >= 10_000_000) return "10m";
  return null;
}

function getPriorityBrainrot(brainrots) {
  if (!brainrots?.length) return null;
  const priority = brainrots
    .filter(b => PRIORITY_NAMES.has(b.name))
    .sort((a, b) => b.value - a.value);
  return priority[0] || null;
}

function getEmbedColor(tier) {
  const colors = {
    "1b": 0x800080,    // Purple
    "300m": 0xFF0000,  // Red
    "100m": 0xFF4500,  // Orange-Red
    "50m": 0xFFA500,   // Orange
    "10m": 0xFFFF00    // Yellow
  };
  return colors[tier] || 0xFFFF00;
}

// ======== WEBHOOK QUEUE PROCESSOR ========
async function processWebhookQueue() {
  if (isProcessingQueue || webhookQueue.length === 0) return;
  
  isProcessingQueue = true;
  
  while (webhookQueue.length > 0) {
    const { webhook, content, embed, key } = webhookQueue.shift();
    
    try {
      const resp = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content || " ", embeds: [embed] })
      });
      
      if (resp.status === 429) {
        // Rate limited - put back in queue and wait
        webhookQueue.unshift({ webhook, content, embed, key });
        const retryAfter = parseInt(resp.headers.get('retry-after') || '5') * 1000;
        console.log(`⏳ Rate limited, waiting ${retryAfter}ms`);
        await sleep(retryAfter);
      } else {
        console.log(`✅ Sent: ${embed.title?.slice(0, 50)} [${key?.slice(0, 30)}]`);
      }
    } catch (err) {
      console.error(`❌ Webhook error:`, err.message);
    }
    
    // Delay between sends to avoid rate limits
    await sleep(WEBHOOK_BATCH_DELAY_MS);
  }
  
  isProcessingQueue = false;
}

function queueWebhook(webhook, content, embed, uniqueKey) {
  if (uniqueKey && sentMessages.has(uniqueKey)) {
    return; // Skip duplicate
  }
  if (uniqueKey) sentMessages.add(uniqueKey);
  
  webhookQueue.push({ webhook, content, embed, key: uniqueKey });
  processWebhookQueue();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ======== BUFFER PROCESSOR ========
setInterval(() => {
  for (const [jobId, buffer] of serverBuffers.entries()) {
    if (!buffer?.length) continue;
    
    // Sort by value descending
    buffer.sort((a, b) => b.value - a.value);
    
    // Determine best tier
    const topValue = buffer[0].value;
    const targetTier = getTierFromValue(topValue);
    if (!targetTier) continue;
    
    // Build embed
    const filtered = buffer.filter(b => b.value >= 10_000_000);
    if (!filtered.length) continue;
    
    const topItem = filtered[0];
    
    // Format money value
    const formatMoney = (val) => {
      if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)}B/s`;
      if (val >= 1_000_000) return `$${Math.round(val / 1_000_000)}M/s`;
      return `$${Math.round(val / 1000)}K/s`;
    };
    
    // Build "Others" list (exclude the top item)
    const others = filtered
      .filter(b => b.name !== topItem.name || b.gen !== topItem.gen)
      .slice(0, 5)
      .map(b => `${b.name}: ${formatMoney(b.value)}`)
      .join('\n');
    
    // Determine tier label for title
    let tierLabel = "10M+";
    if (topValue >= 1_000_000_000) tierLabel = "1B+";
    else if (topValue >= 300_000_000) tierLabel = "300M+";
    else if (topValue >= 100_000_000) tierLabel = "100M+";
    else if (topValue >= 50_000_000) tierLabel = "50M+";
    
    // Get the bot that detected this
    const detectedBy = topItem.botId || "Unknown";
    
    const embed = {
      title: `Xen Notifier | ${tierLabel}`,
      color: getEmbedColor(targetTier),
      fields: [
        {
          name: "Name",
          value: topItem.name,
          inline: true
        },
        {
          name: "Money/sec",
          value: formatMoney(topItem.value),
          inline: true
        },
        {
          name: "Players",
          value: `${buffer[0].players}/8`,
          inline: true
        },
        {
          name: "Job ID",
          value: jobId,
          inline: false
        },
        {
          name: "Join Script",
          value: `\`\`\`lua\ngame:GetService("TeleportService"):TeleportToPlaceInstance(109983668079237,"${jobId}",game.Players.LocalPlayer)\`\`\``,
          inline: false
        }
      ],
      footer: { text: `Bot ${detectedBy} scanning • Xen Notifier` },
      timestamp: new Date().toISOString()
    };
    
    // Add "Others" field if there are more brainrots
    if (others) {
      embed.fields.push({
        name: "Others",
        value: `\`\`\`\n${others}\`\`\``,
        inline: false
      });
    }
    
    const namesKey = filtered.map(b => `${b.name}-${b.gen}`).sort().join("_").slice(0, 100);
    const key = `main_${jobId}_${targetTier}_${namesKey}`;
    
    if (WEBHOOKS[targetTier]) {
      queueWebhook(WEBHOOKS[targetTier], ROLE_MENTIONS[targetTier], embed, key);
    }
    
    // Highlight for 100M+ OR special priority items
    const hasHighlightPriority = filtered.some(b => HIGHLIGHT_PRIORITY_NAMES.has(b.name));
    const shouldHighlight = topValue >= 100_000_000 || hasHighlightPriority;
    
    if (HIGHLIGHT_WEBHOOK && shouldHighlight) {
      // Build highlight embed WITHOUT Job ID and Join Script
      const highlightFields = [
        {
          name: "Name",
          value: topItem.name,
          inline: true
        },
        {
          name: "Money/sec",
          value: formatMoney(topItem.value),
          inline: true
        },
        {
          name: "Players",
          value: `${buffer[0].players}/8`,
          inline: true
        }
      ];
      
      // Add "Others" if there are more brainrots
      if (others) {
        highlightFields.push({
          name: "Others",
          value: `\`\`\`\n${others}\`\`\``,
          inline: false
        });
      }
      
      const highlightEmbed = {
        title: hasHighlightPriority ? `Xen Notifier | Priority` : `Xen Notifier | ${tierLabel}`,
        color: hasHighlightPriority ? 0xFF00FF : getEmbedColor(targetTier),
        fields: highlightFields,
        footer: { text: `Bot ${detectedBy} scanning • Xen Notifier` },
        timestamp: new Date().toISOString()
      };
      
      queueWebhook(HIGHLIGHT_WEBHOOK, "", highlightEmbed, `highlight_${key}`);
    }
    
    // Clear buffer
    serverBuffers.delete(jobId);
  }
}, 500);

// ======== CLEANUP ========
setInterval(() => {
  autoJoinerServers.length = 0;
  console.log("🧹 AutoJoiner buffer cleared");
}, AUTOJOINER_BUFFER_CLEAN_SEC * 1000);

// ======== BOT STATS SENDER ========
let lastBotStatsMessageId = null;

async function sendBotStats() {
  if (!BOT_STATS_WEBHOOK) return;
  
  const botCount = getActiveBotCount();
  const botList = getActiveBotsList();
  
  const embed = {
    title: "🤖 Xen Notifier | Bot Status",
    color: botCount > 0 ? 0x00FF00 : 0xFF0000,  // Green if bots active, red if none
    fields: [
      {
        name: "Active Bots",
        value: `**${botCount}** bots scanning`,
        inline: true
      },
      {
        name: "Status",
        value: botCount > 0 ? "🟢 Online" : "🔴 No bots active",
        inline: true
      }
    ],
    footer: { text: "Updates every 60 seconds • Xen Notifier" },
    timestamp: new Date().toISOString()
  };
  
  // Add bot list if not too many
  if (botList.length > 0 && botList.length <= 20) {
    embed.fields.push({
      name: "Bot Names",
      value: `\`\`\`\n${botList.join(', ')}\`\`\``,
      inline: false
    });
  } else if (botList.length > 20) {
    embed.fields.push({
      name: "Bot Names",
      value: `\`\`\`\n${botList.slice(0, 20).join(', ')}... and ${botList.length - 20} more\`\`\``,
      inline: false
    });
  }
  
  try {
    // Delete previous message if exists
    if (lastBotStatsMessageId) {
      try {
        await fetch(`${BOT_STATS_WEBHOOK}/messages/${lastBotStatsMessageId}`, {
          method: "DELETE"
        });
      } catch (e) { /* ignore delete errors */ }
    }
    
    // Send new message
    const resp = await fetch(`${BOT_STATS_WEBHOOK}?wait=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] })
    });
    
    if (resp.ok) {
      const data = await resp.json();
      lastBotStatsMessageId = data.id;
      console.log(`📊 Bot stats sent: ${botCount} active bots`);
    }
  } catch (err) {
    console.error("Bot stats error:", err.message);
  }
}

// Send stats on startup and every interval
setTimeout(sendBotStats, 5000);  // Initial delay
setInterval(sendBotStats, BOT_STATS_INTERVAL_MS);

// ======== ENDPOINTS ========
app.post("/add-server", (req, res) => {
  try {
    const { jobId, players, brainrots, timestamp, botId } = req.body;
    
    // Track this bot as active (even if no brainrots)
    if (botId) {
      trackBot(botId);
    }
    
    if (!jobId || !brainrots?.length) {
      return res.status(400).json({ error: "Missing jobId or brainrots" });
    }
    
    // Initialize buffer
    if (!serverBuffers.has(jobId)) {
      serverBuffers.set(jobId, []);
    }
    
    const buffer = serverBuffers.get(jobId);
    
    for (const b of brainrots) {
      const value = b.value || 0;
      
      // Add to buffer
      buffer.push({
        serverId: jobId,
        name: b.name,
        gen: b.gen,
        value: value,
        players: players || 0,
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        botId: botId || b.botId || "Unknown"
      });
      
      // Add to autojoiner if valuable
      if (value >= 10_000_000 && autoJoinerServers.length < MAX_BUFFER_SIZE) {
        autoJoinerServers.push({
          jobId,
          numericMPS: value,
          name: b.name,
          gen: b.gen,
          players: players || 0,
          detectedAt: new Date().toISOString()
        });
      }
    }
    
    console.log(`📩 ${jobId} | ${brainrots.length} brainrots | ${players} players`);
    res.sendStatus(200);
    
  } catch (err) {
    console.error("add-server error:", err);
    res.sendStatus(500);
  }
});

// AutoJoiner endpoints
app.get("/Autojoiner", (req, res) => {
  // Return sorted by value (best first)
  const sorted = [...autoJoinerServers].sort((a, b) => b.numericMPS - a.numericMPS);
  res.json(sorted.slice(0, 100));
});

app.get("/get-server", (req, res) => {
  if (!autoJoinerServers.length) {
    return res.status(404).json({ error: "No servers available" });
  }
  // Pop best server
  autoJoinerServers.sort((a, b) => b.numericMPS - a.numericMPS);
  const server = autoJoinerServers.shift();
  res.json(server);
});

app.get("/get-servers", (req, res) => {
  const sorted = [...autoJoinerServers].sort((a, b) => b.numericMPS - a.numericMPS);
  res.json({
    job_ids: sorted.slice(0, 50).map(e => ({
      jobId: e.jobId,
      name: e.name,
      ms: e.gen,
      players: e.players,
      value: e.numericMPS
    }))
  });
});

app.get("/status", (req, res) => {
  // Count total script users across all servers
  let totalScriptUsers = 0;
  for (const users of scriptUsers.values()) {
    totalScriptUsers += users.size;
  }
  
  res.json({
    serverBuffers: serverBuffers.size,
    webhookQueueSize: webhookQueue.length,
    autoJoinerBuffered: autoJoinerServers.length,
    dedupCacheSize: sentMessages.size(),
    activeBotsCount: getActiveBotCount(),
    activeBots: getActiveBotsList(),
    scriptUsersCount: totalScriptUsers,
    scriptUserServers: scriptUsers.size
  });
});

// Dedicated bot stats endpoint
app.get("/bots", (req, res) => {
  res.json({
    count: getActiveBotCount(),
    bots: getActiveBotsList(),
    timeout: BOT_ACTIVE_TIMEOUT_MS / 1000 + " seconds"
  });
});

// Force send bot stats to webhook
app.get("/bots/ping", async (req, res) => {
  await sendBotStats();
  res.json({ sent: true, count: getActiveBotCount() });
});

app.post("/add-pool", (req, res) => {
  const data = req.body;
  if (!data?.servers?.length) {
    return res.status(400).json({ error: "Missing 'servers' array" });
  }
  
  let added = 0;
  const existingIds = new Set(autoJoinerServers.map(s => s.jobId));
  
  for (const jobId of data.servers) {
    if (jobId && !existingIds.has(jobId) && autoJoinerServers.length < MAX_BUFFER_SIZE) {
      autoJoinerServers.push({
        jobId,
        numericMPS: 0,
        name: null,
        gen: null,
        players: 0,
        detectedAt: new Date().toISOString()
      });
      existingIds.add(jobId);
      added++;
    }
  }
  
  res.json({ added });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

// Heartbeat endpoint - bots call this to register as active
app.post("/heartbeat", (req, res) => {
  const { botId } = req.body;
  if (botId) {
    trackBot(botId);
    res.json({ tracked: true, activeBots: getActiveBotCount() });
  } else {
    res.status(400).json({ error: "Missing botId" });
  }
});

// Also support GET for simpler heartbeat
app.get("/heartbeat/:botId", (req, res) => {
  const botId = req.params.botId;
  if (botId) {
    trackBot(botId);
    res.json({ tracked: true, activeBots: getActiveBotCount() });
  } else {
    res.status(400).json({ error: "Missing botId" });
  }
});

// ======== SCRIPT USER TRACKING (for player highlights) ========
// Clean up expired script users
function cleanupScriptUsers() {
  const now = Date.now();
  for (const [jobId, users] of scriptUsers.entries()) {
    for (const [userId, data] of users.entries()) {
      if (now - data.timestamp > SCRIPT_USER_TIMEOUT_MS) {
        users.delete(userId);
      }
    }
    if (users.size === 0) {
      scriptUsers.delete(jobId);
    }
  }
}

// Register user as script user
app.post("/register-user", (req, res) => {
  const { userId, username, jobId } = req.body;
  if (!userId || !jobId) {
    return res.status(400).json({ error: "Missing userId or jobId" });
  }
  
  if (!scriptUsers.has(jobId)) {
    scriptUsers.set(jobId, new Map());
  }
  
  scriptUsers.get(jobId).set(String(userId), {
    username: username || "Unknown",
    timestamp: Date.now()
  });
  
  // Also track as active bot if username provided
  if (username) {
    trackBot(username);
  }
  
  res.json({ registered: true });
});

// Get script users in a server
app.get("/script-users", (req, res) => {
  const jobId = req.query.jobId;
  if (!jobId) {
    return res.status(400).json({ error: "Missing jobId" });
  }
  
  cleanupScriptUsers();
  
  const users = scriptUsers.get(jobId);
  if (!users || users.size === 0) {
    return res.json([]);
  }
  
  const userIds = Array.from(users.keys()).map(id => parseInt(id));
  res.json(userIds);
});

// Unregister user when leaving
app.post("/unregister-user", (req, res) => {
  const { userId, jobId } = req.body;
  if (!userId || !jobId) {
    return res.status(400).json({ error: "Missing userId or jobId" });
  }
  
  const users = scriptUsers.get(jobId);
  if (users) {
    users.delete(String(userId));
    if (users.size === 0) {
      scriptUsers.delete(jobId);
    }
  }
  
  res.json({ unregistered: true });
});

// Cleanup interval
setInterval(cleanupScriptUsers, 15000);

// ======== START ========
app.listen(PORT, () => {
  console.log(`✅ Optimized Notifier running on port ${PORT}`);
});
