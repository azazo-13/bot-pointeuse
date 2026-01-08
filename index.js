const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require("discord.js");
const fetch = require("node-fetch");
const express = require("express");

const TOKEN = process.env.TOKEN;
const SHEET_URL = process.env.SHEET_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const DEPLOY_COMMANDS = process.env.DEPLOY_COMMANDS === "true";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

async function deployCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("creatp")
      .setDescription("Créer la pointeuse")
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  if (GUILD_ID) {
    console.log("⏳ Déploiement commandes GUILD...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commandes GUILD déployées");
  }

  console.log("⏳ Déploiement commandes GLOBAL...");
  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    { body: commands }
  );
  console.log("✅ Commandes GLOBAL déployées");
}


client.once("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  if (DEPLOY_COMMANDS) {
    console.log("🚀 Mode déploiement des commandes activé");
    await deployCommands();
  }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "start",
          userId: member.id,
          name,
          date: now.toLocaleDateString("fr-FR"),
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "end",
          userId: member.id,
          name,
          end: now.toISOString("fr-FR")
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
