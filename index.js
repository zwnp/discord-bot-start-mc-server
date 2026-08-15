"use strict";

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
} = require("discord.js");
const express = require("express");
const http = require("http");
const https = require("https");

// ============================================================
// CONFIG — set these as environment variables
// ============================================================
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID; // your bot's application/client ID
const FALIX_API_KEY = process.env.FALIX_API_KEY; // flx_live_...
const FALIX_SERVER_ID = process.env.FALIX_SERVER_ID; // numeric server id from GET /servers

const FALIX_BASE = "https://client.falixnodes.net/api/v2";

if (!DISCORD_BOT_TOKEN || !DISCORD_CLIENT_ID || !FALIX_API_KEY || !FALIX_SERVER_ID) {
  console.error(
    "Missing required environment variables. Set DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, FALIX_API_KEY, FALIX_SERVER_ID.",
  );
  process.exit(1);
}

// ============================================================
// FALIX API HELPERS
// ============================================================
async function falixRequest(path, options = {}) {
  const res = await fetch(`${FALIX_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${FALIX_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const err = body?.error;
    const message = err?.message || `HTTP ${res.status}`;
    const code = err?.code || "unknown_error";
    const e = new Error(message);
    e.code = code;
    e.status = res.status;
    e.actionUrl = err?.action_url;
    throw e;
  }

  return body?.data;
}

async function getServerStatus() {
  return falixRequest(`/servers/${FALIX_SERVER_ID}/status`);
}

async function sendPower(signal) {
  // signal: "start" | "stop" | "restart" | "kill"
  return falixRequest(`/servers/${FALIX_SERVER_ID}/power`, {
    method: "POST",
    body: JSON.stringify({ signal }),
    headers: {
      // Idempotency-Key avoids double-starting if Discord retries the interaction
      "Idempotency-Key": `discord-power-${signal}-${Date.now()}`,
    },
  });
}

// ============================================================
// DISCORD SLASH COMMANDS
// ============================================================
const commands = [
  new SlashCommandBuilder()
    .setName("startserver")
    .setDescription("Start the Minecraft server"),
  new SlashCommandBuilder()
    .setName("serverstatus")
    .setDescription("Check the Minecraft server's current status"),
].map((cmd) => cmd.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(DISCORD_BOT_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(DISCORD_CLIENT_ID), {
      body: commands,
    });
    console.log("Slash commands registered.");
  } catch (err) {
    console.error("Failed to register slash commands:", err);
  }
}

// ============================================================
// STATUS FORMATTING
// ============================================================
function stateEmoji(state) {
  switch (state) {
    case "running":
      return "🟢";
    case "starting":
      return "🟡";
    case "stopping":
      return "🟠";
    case "offline":
    default:
      return "🔴";
  }
}

function buildStatusEmbed(status) {
  const embed = new EmbedBuilder()
    .setTitle("Minecraft Server Status")
    .setColor(status.state === "running" ? 0x3fb950 : 0x8b949e)
    .addFields({
      name: "State",
      value: `${stateEmoji(status.state)} ${status.state}`,
      inline: true,
    });

  if (status.node_ready === false) {
    embed.addFields({ name: "Node", value: "⚠️ Not reachable right now", inline: true });
  }

  if (status.resources) {
    const r = status.resources;
    if (r.cpu_absolute !== undefined) {
      embed.addFields({ name: "CPU", value: `${r.cpu_absolute.toFixed(1)}%`, inline: true });
    }
    if (r.memory_bytes !== undefined) {
      const mb = (r.memory_bytes / 1024 / 1024).toFixed(0);
      embed.addFields({ name: "Memory", value: `${mb} MB`, inline: true });
    }
    if (r.uptime !== undefined && status.state === "running") {
      const seconds = Math.floor(r.uptime / 1000);
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      embed.addFields({ name: "Uptime", value: `${h}h ${m}m`, inline: true });
    }
  }

  return embed;
}

// ============================================================
// DISCORD CLIENT
// ============================================================
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "startserver") {
    await interaction.deferReply();
    try {
      const current = await getServerStatus();

      if (current.state === "running") {
        await interaction.editReply("The server is already online.");
        return;
      }
      if (current.state === "starting") {
        await interaction.editReply("The server is already starting up — give it a minute.");
        return;
      }

      await sendPower("start");
      await interaction.editReply(
        "Starting the server now — this can take a minute or two. Use `/serverstatus` to check on it.",
      );
    } catch (err) {
      if (err.code === "ad_required") {
        await interaction.editReply(
          `This is a free-plan server and needs an ad view before it can start. Watch it here, then try again within 5 minutes: ${err.actionUrl}`,
        );
      } else if (err.code === "server_suspended") {
        await interaction.editReply("This server is currently suspended and can't be started.");
      } else {
        await interaction.editReply(`Failed to start the server: ${err.message}`);
      }
    }
  }

  if (interaction.commandName === "serverstatus") {
    await interaction.deferReply();
    try {
      const status = await getServerStatus();
      await interaction.editReply({ embeds: [buildStatusEmbed(status)] });
    } catch (err) {
      await interaction.editReply(`Failed to fetch server status: ${err.message}`);
    }
  }
});

// ============================================================
// KEEP-ALIVE WEB SERVER
// Render free Web Services spin down after ~15 min with no
// incoming HTTP traffic. This tiny server plus the self-ping
// below keeps this Discord bot's process alive 24/7.
// ============================================================
const app = express();
const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Discord bot is running.");
});
app.get("/ping", (req, res) => res.send("pong"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Keep-alive server listening on port ${PORT}`);
});

function startSelfPing() {
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    console.log("No RENDER_EXTERNAL_URL set — self-ping disabled (running locally).");
    return;
  }
  setInterval(
    () => {
      const protocol = renderUrl.startsWith("https") ? https : http;
      protocol.get(`${renderUrl}/ping`, () => {}).on("error", () => {});
    },
    10 * 60 * 1000, // every 10 minutes
  );
  console.log("Self-ping started (every 10 min).");
}

startSelfPing();

// ============================================================
// START
// ============================================================
(async () => {
  await registerCommands();
  await client.login(DISCORD_BOT_TOKEN);
})();
