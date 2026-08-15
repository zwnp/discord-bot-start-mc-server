# Falix Discord Bot

Slash-command Discord bot that starts your Falix Minecraft server and
reports its status, using Falix's official public API (v2).

## Commands
- `/startserver` — starts the server if it's offline
- `/serverstatus` — shows current state, CPU, memory, and uptime

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Find your Falix server ID**
   Run this once with your API key to list your servers and their IDs:
   ```
   curl https://client.falixnodes.net/api/v2/servers \
     -H "Authorization: Bearer flx_live_..."
   ```
   Note the `id` field for your server.

3. **Set environment variables** (e.g. in a `.env` file if you use
   `dotenv`, or directly in your host's environment settings):
   ```
   DISCORD_BOT_TOKEN=your-discord-bot-token
   DISCORD_CLIENT_ID=your-discord-application-client-id
   FALIX_API_KEY=flx_live_...
   FALIX_SERVER_ID=your-server-id-from-step-2
   ```

   `DISCORD_CLIENT_ID` is your bot's Application ID, found on the
   [Discord Developer Portal](https://discord.com/developers/applications)
   under your application's General Information page — not the bot token.

4. **Invite the bot to your server** with the `applications.commands`
   and `bot` scopes (Send Messages permission is enough).

5. **Run it**
   ```
   npm start
   ```
   On first run it registers the two slash commands globally — they can
   take up to an hour to show up everywhere, though they usually appear
   within a few minutes.

## Falix API key permissions

When creating the API key in the Falix dashboard, grant at least:
- `servers:read` (to check status)
- `servers:power` (to start the server)

Both are included under the "Manage servers" preset permission group.

## Notes
- Free-plan Falix servers require a recent ad view before they can be
  started via the API. If that happens, `/startserver` will reply with
  a link to watch the ad — do that, then run `/startserver` again
  within 5 minutes.
- The bot only *starts* the server — it doesn't run inside it. Pair
  this with the AFK bot if you want the server to stay online once
  it's up, rather than shutting down again from inactivity.
