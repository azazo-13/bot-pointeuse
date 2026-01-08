const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");
const fetch = require("node-fetch");
const express = require("express");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// Slash command
client.on("interactionCreate", async interaction => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "creatp") {
      const embed = new EmbedBuilder()
        .setTitle("🕒 Pointeuse")
        .setDescription("Clique sur Start ou End");

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("start").setLabel("Start").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("end").setLabel("End").setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ embeds: [embed], components: [row] });
    }
  }

  if (interaction.isButton()) {
    const member = interaction.member;
    const name = member.nickname || member.user.username;
    const roles = member.roles.cache.map(r => r.name).filter(r => r !== "@everyone");
    const now = new Date();

    if (interaction.customId === "start") {
      const res = await fetch(SHEET_URL, {
        method: "POST",
        body: JSON.stringify({
          type: "start",
          name,
          date: now.toLocaleDateString(),
          start: now.toISOString(),
          roles
        })
      });

      const data = await res.json();
      if (data.error) return interaction.reply({ content: "⛔ Déjà en service", ephemeral: true });

      interaction.reply({ content: "✅ Service commencé", ephemeral: true });
    }

    if (interaction.customId === "end") {
      const res = await fetch(SHEET_URL, {
        method: "POST",
        body: JSON.stringify({
          type: "end",
          name,
          end: now.toISOString()
        })
      });

      const data = await res.json();
      if (data.error) return interaction.reply({ content: "⛔ Aucun service actif", ephemeral: true });

      interaction.reply({
        content: `🧾 Service terminé\n⏱ Heures : ${data.hours}\n💰 Salaire : ${data.salary}€`,
        ephemeral: true
      });
    }
  }
});

// Ping Render
const app = express();
app.get("/", (req, res) => res.send("Bot en ligne"));
app.listen(3000);

client.login(TOKEN);
