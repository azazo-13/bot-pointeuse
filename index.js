require("dotenv").config();
const { 
  Client, 
  GatewayIntentBits, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder 
} = require("discord.js");
const fetch = require("node-fetch");
const express = require("express");

// --- Variables d'environnement ---
const TOKEN = process.env.TOKEN;
const SHEET_URL = process.env.SHEET_URL;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// --- Client Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// --- Déploiement des commandes ---
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
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Commandes GUILD déployées");
  }

  console.log("⏳ Déploiement commandes GLOBAL...");
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Commandes GLOBAL déployées");
}

// --- Ready ---
client.once("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);

  // Déployer automatiquement si besoin
  try {
    await deployCommands();
  } catch (err) {
    console.error("Erreur déploiement commandes :", err);
  }
});

// --- Interaction slash & boutons ---
client.on("interactionCreate", async interaction => {
  const member = interaction.member;
  const now = new Date();
  const name = member ? (member.nickname || member.user.username) : "Unknown";

  // --- Slash command ---
  if (interaction.isChatInputCommand() && interaction.commandName === "creatp") {
    const embed = new EmbedBuilder()
      .setTitle("🕒 Pointeuse")
      .setDescription("Clique sur Start ou End");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("start").setLabel("Start").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("end").setLabel("End").setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  // --- Boutons ---
  if (interaction.isButton()) {
    const roles = member.roles.cache.map(r => r.name).filter(r => r !== "@everyone");

    await interaction.deferReply({ ephemeral: true }); // donne plus de temps

    if (interaction.customId === "start") {
      try {
        const res = await fetch(SHEET_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "start",
            userId: member.id,
            name,
            date: now.toLocaleString("fr-FR"),
            start: now.toISOString(),
            roles
          })
        });

        const data = await res.json();
        if (data.error) return interaction.editReply({ content: "⛔ Déjà en service" });

        return interaction.editReply({ content: "✅ Service commencé" });
      } catch (err) {
        console.error(err);
        return interaction.editReply({ content: "❌ Erreur lors de l'enregistrement" });
      }
    }

    if (interaction.customId === "end") {
      try {
        const res = await fetch(SHEET_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "end",
            userId: member.id,
            name,
            end: now.toISOString()
          })
        });

        const data = await res.json();
        if (data.error) return interaction.editReply({ content: "⛔ Aucun service actif" });

        return interaction.editReply({
          content: `🧾 Service terminé\n⏱ Heures : ${data.hours}\n💰 Salaire : ${data.salary}€`
        });
      } catch (err) {
        console.error(err);
        return interaction.editReply({ content: "❌ Erreur lors de la clôture du service" });
      }
    }
  }
});

// --- Ping Render ---
const app = express();
app.get("/", (req, res) => res.send("Bot en ligne"));
app.listen(3000, () => console.log("🌐 Serveur ping actif sur port 3000"));

// --- Login Discord ---
client.login(TOKEN);
