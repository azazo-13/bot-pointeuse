// --- Lancement du script ---
console.log("🚀 Lancement du bot pointeuse...");

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
const GUILD_ID = process.env.GUILD_ID; // Utilisé pour déploiement immédiat sur serveur test

console.log("TOKEN défini ?", TOKEN ? "✅ Oui" : "❌ Non");

// --- Client Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// --- Ready ---
client.once("ready", async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag} (Online)`);

  try {
    await deployCommands();
  } catch (err) {
    console.error("[READY ERROR]", err);
  }
});

// --- Login Discord ---
client.login(TOKEN).then(() => {
  console.log("🔑 Tentative de connexion au bot Discord...");
}).catch(err => {
  console.error("❌ Impossible de se connecter au bot Discord :", err);
});


// --- Déploiement des commandes ---
async function deployCommands() {
  console.log("⏳ Déploiement des commandes...");
  const commands = [
    new SlashCommandBuilder()
      .setName("creatp")
      .setDescription("Créer la pointeuse")
      .toJSON()
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    if (GUILD_ID) {
      console.log(`[DEPLOY] Déploiement commandes sur le serveur GUILD ${GUILD_ID}...`);
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("✅ Commandes GUILD déployées avec succès !");
    }

    console.log("[DEPLOY] Déploiement commandes GLOBAL...");
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("✅ Commandes GLOBAL déployées avec succès !");
  } catch (err) {
    console.error("[DEPLOY ERROR]", err);
  }
}

// --- Events pour détecter disconnect/reconnect ---
client.on("shardDisconnect", (event, shardID) => {
  console.warn(`⚠️ Bot déconnecté du shard ${shardID}`, event);
});

client.on("shardReconnecting", shardID => {
  console.log(`🔄 Bot reconnecting shard ${shardID}...`);
});

client.on("error", err => {
  console.error("❌ Erreur Discord.js :", err);
});

// --- Interaction slash & boutons ---
client.on("interactionCreate", async interaction => {
  const member = interaction.member;
  const now = new Date();
  const name = member ? (member.nickname || member.user.username) : "Unknown";

  // --- Slash command /creatp ---
  if (interaction.isChatInputCommand() && interaction.commandName === "creatp") {
    console.log(`[ACTION] ${interaction.user.username} a utilisé /creatp à ${now.toLocaleString()}`);

    const embed = new EmbedBuilder()
      .setTitle("🕒 Pointeuse")
      .setDescription("Clique sur Start ou End");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("start")
        .setLabel("Start")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("end")
        .setLabel("End")
        .setStyle(ButtonStyle.Danger)
    );

    // ⚡ Réponse immédiate visible pour tous, plus de "L'application ne répond plus"
    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // --- Boutons Start/End ---
  if (interaction.isButton()) {
    const roles = member.roles.cache.map(r => r.name).filter(r => r !== "@everyone");
    console.log(`[ACTION] ${name} a cliqué sur "${interaction.customId}" à ${now.toLocaleString()}`);

    await interaction.deferReply({ ephemeral: true }); // Temps pour traitement

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

        if (data.error) {
          console.log(`[START] ${name} était déjà en service`);
          return interaction.editReply({ content: "⛔ Déjà en service" });
        }

        console.log(`[START] ${name} a commencé le service à ${now.toLocaleString()}`);
        return interaction.editReply({ content: "✅ Service commencé" });
      } catch (err) {
        console.error(`[START ERROR] ${name}`, err);
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

        if (data.error) {
          console.log(`[END] ${name} n'avait aucun service actif`);
          return interaction.editReply({ content: "⛔ Aucun service actif" });
        }

        console.log(`[END] ${name} a terminé le service. Heures: ${data.hours}, Salaire: ${data.salary}€`);
        return interaction.editReply({
          content: `🧾 Service terminé\n⏱ Heures : ${data.hours}\n💰 Salaire : ${data.salary}€`
        });
      } catch (err) {
        console.error(`[END ERROR] ${name}`, err);
        return interaction.editReply({ content: "❌ Erreur lors de la clôture du service" });
      }
    }
  }
});

// --- Ping Render ---
const app = express();
app.get("/", (req, res) => {
  console.log(`[PING] Serveur ping reçu à ${new Date().toLocaleString()}`);
  res.send("Bot en ligne");
});
app.listen(3000, () => console.log("🌐 Serveur ping actif sur port 3000"));

// --- Ping automatique toutes les 5 minutes ---
const SELF_URL = process.env.RENDER_INTERNAL_URL || process.env.PUBLIC_URL;

if (SELF_URL) {
  console.log(`🔄 Ping automatique activé vers ${SELF_URL} toutes les 5 minutes`);
  
  setInterval(async () => {
    try {
      const res = await fetch(SELF_URL);
      console.log(`[AUTO PING] Ping envoyé à ${SELF_URL} - Status: ${res.status}`);
    } catch (err) {
      console.error(`[AUTO PING ERROR] Impossible de ping ${SELF_URL}:`, err);
    }
  }, 5 * 60 * 1000);
} else {
  console.warn("⚠️ SELF_URL non défini. Le ping automatique ne fonctionnera pas !");
}

