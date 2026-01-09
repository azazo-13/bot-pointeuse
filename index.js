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
const GUILD_ID = process.env.GUILD_ID;

console.log("TOKEN défini ?", TOKEN ? "✅ Oui" : "❌ Non");

// --- Client Discord ---
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// --- Login Discord ---
client.login(TOKEN)
  .then(() => console.log("🔑 Tentative de connexion au bot Discord..."))
  .catch(err => console.error("❌ Impossible de se connecter au bot Discord :", err));

// --- Ready ---
client.once("ready", async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag} (Online)`);

  try {
    await deployCommands();
  } catch (err) {
    console.error("[READY ERROR]", err);
  }
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

// --- Gestion des Slash Commands ---
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "creatp") {
    console.log(`[ACTION] ${interaction.user.username} a utilisé /creatp à ${new Date().toLocaleString()}`);

    const embed = new EmbedBuilder()
      .setTitle("🕒 Gestion des Pointages")
      .setDescription("Utilisez les réactions pour enregistrer votre présence :\n\n🟢 **Commencer le service**\n🔴 **Terminer le service**")
      .setColor("#FFA500") // Orange
      .setFooter({ text: "Pointage automatique", iconURL: "https://files.catbox.moe/rfaerg.png" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("pointeuse:start")
        .setLabel("🟢 Début de service")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("pointeuse:end")
        .setLabel("🔴 Fin de service")
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }
});

// --- Gestion des boutons  ---
client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

    // 🔒 Ignore tous les boutons qui ne sont pas à toi
  if (!interaction.customId.startsWith("pointeuse:")) return;
  
  if (interaction.customId === "pointeuse:start") {
    return handleStart(interaction);
  }

  if (interaction.customId === "pointeuse:end") {
    return handleEnd(interaction);
  }

  if (interaction.customId === "pointeuse:paie") {
  return handlePaie(interaction);
  }
  
});

// --- boutons Start ---
async function handleStart(interaction) {
  const member = interaction.member;
  const name = member ? (member.nickname || member.user.username) : "Unknown";

  const now = new Date();
  const displayDate = now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const isoDate = now.toISOString(); // pour Google Sheets
  console.log(`[START CLICK] ${name} à ${now.toLocaleString()}`);

  await interaction.deferReply({ ephemeral: true });

  try {
    const res = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "start",
        userId: member.id,
        name,
        date: isoDate,
        displayDate,
        start: isoDate,
        roles: member.roles.cache.map(r => r.name).filter(r => r !== "@everyone")
      })
    });

    const data = await res.json();

    if (data.error) {
      return interaction.editReply({ content: "⛔ Déjà en service" });
    }

    console.log(`[START] ${name} a commencé le service`);
    return interaction.editReply({ content: "✅ Service commencé" });

  } catch (err) {
    console.error(`[START ERROR] ${name}`, err);
    return interaction.editReply({ content: "❌ Erreur lors de l'enregistrement" });
  }
}


// --- boutons End ---
async function handleEnd(interaction) {
  const member = interaction.member;
  const name = member ? (member.nickname || member.user.username) : "Unknown";

  
  const now = new Date();
  const displayDate = now.toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  const isoDate = now.toISOString(); // pour Google Sheets
  console.log(`[END CLICK] ${name} à ${now.toLocaleString()}`);

  await interaction.deferReply({ ephemeral: true });

  try {
    const res = await fetch(SHEET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "end",
        userId: member.id,
        name,
        end: isoDate
      })
    });

    const data = await res.json();

    if (data.error) {
      return interaction.editReply({ content: "⛔ Aucun service actif" });
    }

    console.log(`[END] ${name} a terminé le service`);

    const embed = new EmbedBuilder()
      .setTitle("🧾 Récapitulatif de Fin de Service")
      .setColor("#FF5555")
      .addFields(
        { name: "👤 Employé", value: `**${name}**`, inline: true },
        { name: "⏱ Heures travaillées", value: `**${data.hours} h**`, inline: true },
        { name: "💶 Salaire", value: `**${data.salary} €**`, inline: true }
      )
      .setFooter({ text: "Fin de service enregistrée" })
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("pointeuse:paie")
        .setLabel("💶 Payer")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.editReply({ content: "✅ Service clôturé" });

  } catch (err) {
    console.error(`[END ERROR] ${name}`, err);
    return interaction.editReply({ content: "❌ Erreur lors de la clôture" });
  }
}


// --- boutons Paie ---
async function handlePaie(interaction) {
  
  await interaction.deferReply({ ephemeral: true });
  
  // 🔒 Vérification des rôles autorisés
const ROLE_IDS = [
  "789402678379544576",
  "1458255225684234513"
];

const hasPermission = interaction.member.roles.cache
  .some(role => ROLE_IDS.includes(role.id));

if (!hasPermission) {
  return interaction.editReply({
    content: "❌ Vous n'avez pas la permission d'utiliser ce bouton."
  });
}
  
  const name = interaction.user.username;
  console.log(`[PAIE CLICK] ${name}`);
  
  // Vérification que le bouton existe
  if (!interaction.message.components?.[0]?.components?.[0]) {
    return interaction.editReply({ content: "❌ Impossible de traiter le paiement" });
  }
  
// Créer le nouvel embed
  const oldEmbed = interaction.message.embeds[0];
  let newEmbed;
  if (oldEmbed) {
    newEmbed = EmbedBuilder.from(oldEmbed)
      .setColor("Green")
      .setDescription("💶 Paiement validé ! Ce message sera supprimé dans 30 secondes.");
  } else {
    newEmbed = new EmbedBuilder()
      .setColor("Green")
      .setDescription("💶 Paiement validé ! Ce message sera supprimé dans 30 secondes.");
  }

  // Désactiver le bouton
  const disabledRow = new ActionRowBuilder().addComponents(
    ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true)
  
  );
  await interaction.message.edit({ embeds: [newEmbed], components: [disabledRow] });

  await interaction.editReply({ content: "✅ Paiement confirmé !" });

  // Supprimer après 30 secondes
  setTimeout(async () => {
    try {
      await interaction.message.delete();
      console.log("[PAIE] Message supprimé automatiquement après 30 secondes");
    } catch (err) {
      console.error("[PAIE ERROR] Impossible de supprimer le message", err);
    }
  }, 30 * 1000);
}

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
