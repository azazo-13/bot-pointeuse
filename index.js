const { 
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const GOOGLE_WEBHOOK = "https://script.google.com/macros/s/.../exec";

// Stockage temporaire des grades à ajouter ou mettre à jour
const pendingGrades = new Map(); // { grade: taux }

// ----- Commandes slash -----
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse générale'),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier le taux d’un grade existant')
    .addStringOption(opt => opt.setName('grade').setDescription('Grade à modifier').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Nouveau taux en €').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un nouveau grade avec son taux')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Taux horaire du grade en €').setRequired(true))
].map(cmd => cmd.toJSON());

// ----- Stockage messages et états -----
const userMessages = new Map(); // { userId: message }
const userState = new Map();    // { userId: "active"|"cooldown" }

// ----- Vérification des actions autorisées -----
function isActionAllowed(userId, action) {
  const state = userState.get(userId);
  if (!state) return true;
  if (state === 'active') return action === 'end_service';
  return true;
}

// ----- Gestion des interactions -----
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  // ----- /createp -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'createp') {
    const embed = new EmbedBuilder()
      .setTitle('🕒 Pointeuse générale')
      .setDescription('Cliquez sur les boutons pour gérer votre service.\nGrades : employe, chef, patron')
      .setColor(0x3498db)
      .setFooter({ text: 'Pointeuse automatique' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // ----- /addgrade -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'addgrade') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Permission admin requise", flags: 64 });
    }
    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');
    pendingGrades.set(grade, taux);
    await interaction.reply({ content: `✅ Grade "${grade}" ajouté localement avec un taux de ${taux} €`, flags: 64 });
    flushGradesToGoogleSheet();
  }

  // ----- /settaux -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'settaux') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Permission admin requise", flags: 64 });
    }
    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');
    pendingGrades.set(grade, taux);
    await interaction.reply({ content: `✅ Taux du grade "${grade}" mis à jour localement à ${taux} €`, flags: 64 });
    flushGradesToGoogleSheet();
  }

  // ----- Boutons Start / End -----
  if (interaction.isButton() && ['start_service','end_service'].includes(interaction.customId)) {
    const userId = user.id;
    if (!isActionAllowed(userId, interaction.customId)) {
      return interaction.reply({ content: "❌ Action impossible à ce moment.", ephemeral: true });
    }

    try {
      const grade = "employe"; // par défaut
      const res = await axios.post(GOOGLE_WEBHOOK, {
        type: "pointeuse",
        action: interaction.customId === 'start_service' ? "start" : "end",
        userId,
        username: user.username,
        grade
      });
      const data = res.data;

      if (interaction.customId === 'start_service') {
        userState.set(userId, "active");
        const msg = await interaction.reply({ content: `🟢 Service pris ${user.username} !`, ephemeral: true });
        userMessages.set(userId, msg);
      } else {
        userState.set(userId, "cooldown");
        const embed = new EmbedBuilder()
          .setTitle('🧾 Fin de service')
          .setDescription(`Résumé du service de <@${userId}>`)
          .addFields(
            { name: '👤 Employé', value: `<@${userId}>`, inline: true },
            { name: '📅 Date', value: data.date, inline: true },
            { name: '⏱ Durée', value: data.hours, inline: true },
            { name: '💰 Salaire', value: `${data.salary} €`, inline: true }
          )
          .setColor(0x1abc9c)
          .setFooter({ text: 'Pointeuse automatique' })
          .setTimestamp();

        const payRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`payer_service_${userId}`).setLabel('💵 Payer').setStyle(ButtonStyle.Primary)
        );

        return interaction.reply({ embeds: [embed], components: [payRow] });
      }

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Erreur serveur.', ephemeral: true });
    }
  }

  // ----- Payer Service -----
  if (interaction.isButton() && interaction.customId.startsWith('payer_service_')) {
    const userId = interaction.customId.replace('payer_service_','');
    if (userMessages.has(userId)) {
      try { await userMessages.get(userId).delete(); } catch {}
      userMessages.delete(userId);
    }
    return interaction.reply({ content: `💰 Paiement effectué pour <@${userId}>`, ephemeral: true });
  }

});

// ----- Fonction envoi grades au Sheet -----
async function flushGradesToGoogleSheet() {
  for (const [grade, taux] of pendingGrades.entries()) {
    try {
      await axios.post(GOOGLE_WEBHOOK, { type: "update_taux", grade, taux }, { headers: { "Content-Type": "application/json" } });
      pendingGrades.delete(grade);
    } catch(err) {
      console.error(err.message);
    }
  }
}

// ----- Connexion Bot -----
client.login(process.env.TOKEN);


// ----- Serveur Express pour Render -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot Discord en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur le port ${PORT}`));

// ----- Auto Ping pour Render -----
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  axios.get(SELF_URL).then(()=>console.log('🔁 Ping Render OK')).catch(err=>console.error('❌ Ping Render échoué :',err.message));
}, 5*60*1000);
