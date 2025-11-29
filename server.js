// server.js
const express = require("express");
const fetch = require("node-fetch"); // node-fetch@2
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ======== CONFIG ========
// 🔧 EDIT HERE: Change your private key for AutoJoiner
const AUTOJOINER_KEY = "your-autojoiner-key-here";

// ⏲️ AutoJoiner buffer purge time in seconds
const AUTOJOINER_BUFFER_CLEAN_SEC = 120;

// ======== WEBHOOKS ========
// 🔧 EDIT HERE: Replace "your-webhook-here" with your own Discord Webhooks
const WEBHOOKS = {
  "10m": "https://discord.com/api/webhooks/1444053818278154271/02RKHZ_DafZmvmv6Cr35_llTfIENHXldvXHUdnMPSVP0KQ641SLxAdF3VqFS3bKkBGNp",
  "50m": "https://discord.com/api/webhooks/1444053774468517918/4tPh8KWNfNYOWdDj3CbU687XHtejURQlbOLPuKvUmXxTxhR13z-l6Tx1ESZyDnDA3rp5",
  "100m": "https://discord.com/api/webhooks/1444053732538187808/jAcpkX4Rg6b20bOGaPxmxcRhVCZV-k6Qe65gMpOSK5fHH7HRn5ioqqv4e7AKV-c9yDQc",
  "300m": "https://discord.com/api/webhooks/1444053636543025164/naCk7TbNCtUDJRoV606gJYUBuFwlwThLlSVivfOIdYEyjayY2FEPlxnzNKMm7f_7Eyx1",
  "1b": "https://discord.com/api/webhooks/1444053589923332187/WXwz9yR_IhPtNbdDLgyHDt_M3q9GjSWdvaSicgKL1l8_U7lZ-j94AqfoNnnApqVwtH3H"
};

// ======== ROLE MENTIONS (OPTIONAL) ========
// 🔧 EDIT HERE: Add your role IDs or leave blank ("") if you don't want mentions
const ROLE_MENTIONS = {
  "10m": "<@1444362655426023736>",
  "50m": "<@1444362678276591656>",
  "100m": "<@1444362687709450260>",
  "300m": "<@1444362691077738636",
  "1b": "<@1444362692734353479>"
};

// ======== HIGHLIGHT WEBHOOK ========
// 🔧 EDIT HERE: Put your highlight webhook or leave empty if not used
const HIGHLIGHT_WEBHOOK = "https://discord.com/api/webhooks/1441848571983953951/bZWTcN8pbV06-T8dELQG9y2AVV8SPl6xhYzI4nH9iCkHhGBUREHjWQvao82j9GnvHRaZ";

// ======== PRIORITY NAMES ======
// 🔧 EDIT HERE: Customize or remove these names as you wish
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

// ======== THUMBNAILS ======
// 🔧 EDIT HERE: Add/remove thumbnail URLs (recommended to keep as-is)
const BRAINROT_THUMBNAILS = {
  "Strawberry Elephant": "your-thumbnail-url-here",
  "Meowl": "your-thumbnail-url-here",
  "Dragon Cannelloni": "your-thumbnail-url-here",
  // ... (You can keep or remove the rest)
};

// ======== IN-MEMORY STRUCTURES ========
let serverBuffers = {};
let highlightBuffer = [];
let sentMessages = new Set();
let autoJoinQueue = [];
let jobBestMap = {};
let autoJoinerServers = [];
const AUTOJOINER_MAX_BUFFER = 5000;

// ======== CLEANUP INTERVALS ========
setInterval(() => { sentMessages.clear(); console.log("🧹 Duplicate cache cleared"); }, 15*60*1000);
setInterval(() => { autoJoinerServers = []; console.log(`🧹 autoJoinerServers cleared`); }, AUTOJOINER_BUFFER_CLEAN_SEC*1000);

// ======== HELPERS ========
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
      body: JSON.stringify({ content: content || " ", embeds:[embed] })
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
  list.sort((a,b)=>b.value-b.value);
  return list[0];
}

function getThumbnail(brainrots){
  if(!brainrots || brainrots.length===0) return null;
  const priority = getPriorityBrainrot(brainrots);
  if(priority && BRAINROT_THUMBNAILS[priority.name]) return BRAINROT_THUMBNAILS[priority.name];

  const withThumb = brainrots.filter(b=>BRAINROT_THUMBNAILS[b.name]);
  if(withThumb.length===0) return null;
  withThumb.sort((a,b)=>b.value-b.value);
  return BRAINROT_THUMBNAILS[withThumb[0].name];
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

      const lines = [`\`\`\`${list[0].serverId}\`\`\``];
      for(let i=0; i<list.length; i++){
        let line = `**${list[i].name} — ${list[i].gen}**`;
        if(i===0 && tierKey !== "10m") line = `🥇 **__${list[i].name} — ${list[i].gen}__**`;
        lines.push(line);
      }
      lines.push(`\n👥 **Players:** ${list[0].players}`);

      const priority = getPriorityBrainrot(list);

      const embed = {
        // 🔧 EDIT HERE: Change notifier name/title
        title: priority ? `⚡ ${priority.name} — ${priority.gen}` : "⚡ Xen Notifier ",  
        description: lines.join("\n"),
        color: tierKey === "1b" ? 0x800080 : 16711680,
        footer: { text: `© Xen Notifier ` }, // 🔧 EDIT HERE
        timestamp: new Date(list[0].timestamp * 1000).toISOString(),
        thumbnail: { url: getThumbnail(list) }
      };

      const namesKey = list.map(b=>`${b.name}-${b.gen}`).sort().join("_");
      const key = `main_${jobId}_${targetTier||tierKey}_${namesKey}`;

      promises.push(sendEmbed(WEBHOOKS[targetTier||tierKey], ROLE_MENTIONS[targetTier||tierKey], embed, key));
    }

    // ======== HIGHLIGHT EMBED (50M+) ========
    const seen = new Set();
    const unique = [];

    for(const b of buffer){
      if(b.value < 50_000_000) continue;
      const k = `${b.serverId}_${b.name}_${b.gen}`;
      if(seen.has(k)) continue;
      seen.add(k);
      unique.push(b);
    }

    if(unique.length > 0){
      unique.sort((a,b)=>b.value-b.value);
      const top = unique[0];

      const lines = unique.map(b=>`**${b.name} — ${b.gen}**`);
      lines.push(`\n👥 **Players:** ${top.players}`);

      const priorityH = getPriorityBrainrot(unique);

      const highlightEmbed = {
        // 🔧 EDIT HERE: Customize highlight title
        title: priorityH ? `🌟 ${priorityH.name} — ${priorityH.gen}` : `🌟 ${top.name} — ${top.gen}`,
        description: lines.join("\n"),
        color: 16766720,
        footer: { text: "Xen Notifier On Top" }, // 🔧 EDIT HERE
        timestamp: new Date(top.timestamp * 1000).toISOString(),
        thumbnail: { url: getThumbnail(unique) }
      };

      const highlightKey = `highlight_${jobId}_${unique.map(b=>`${b.name}-${b.gen}`).sort().join("_")}`;
      promises.push(sendEmbed(HIGHLIGHT_WEBHOOK, " ", highlightEmbed, highlightKey));
    }

    delete serverBuffers[jobId];
  }

  await Promise.all(promises);

}, 500);

// ======== ENDPOINTS ========

app.post("/add-server",(req,res)=>{
  try{
    const {jobId,players,brainrots,timestamp} = req.body;

    if(!brainrots || !Array.isArray(brainrots) || brainrots.length===0)
      return res.sendStatus(400);

    if(!jobId) return res.status(400).json({error:"missing jobId"});

    if(!serverBuffers[jobId]) serverBuffers[jobId] = [];

    for(let b of brainrots){
      let tier = (b.tier || "").toLowerCase();

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

    console.log(`📩 Received ${jobId} | ${brainrots.length} brainrots | ${players} players`);
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
  autoJoinerBuffered:autoJoinerServers.length
}));

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
app.listen(PORT,()=>console.log(`✅ API is running on port ${PORT}`));
