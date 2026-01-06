require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK; // Pointeuse
const GOOGLE_WEBHOOK_UPDATE_TAUX = process.env.GOOGLE_WEBHOOK_UPDATE_TAUX; // Update/Add grade

// ----- Commandes slash -----
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse générale'),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier le taux d’un grade existant')
    .addStringOption(option => option.setName('grade').setDescription('Grade à modifier').setRequired(true))
    .addNumberOption(option => option.setName('taux').setDescription('Nouveau taux en €').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un nouveau grade avec son taux')
    .addStringOption(option => option.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(option => option.setName('taux').setDescription('Taux horaire du grade en €').setRequired(true))
].map(cmd => cmd.toJSON());

// ----- Enregistrement commandes -----
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Mise à jour des commandes globales...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Commandes globales mises à jour');
  } catch (err) {
    console.error('❌ Erreur lors de l’enregistrement global :', err);
  }
})();

// ----- Stockage messages et états -----
const userMessages = new Map(); // { userId: message }
const userState = new Map(); // { userId: { status: "active"|"pause"|"cooldown", cooldownEnd: Date } }

// ----- Helpers -----
function isActionAllowed(userId, action) {
  const state = userState.get(userId);
  const now = new Date();

  if (!state) return true;
  if (state.status === 'cooldown') {
    if (now < state.cooldownEnd) return false;
    userState.delete(userId);
    return true;
  }
  if (state.status === 'active') return action === 'pause_service' || action === 'end_service';
  if (state.status === 'pause') return action === 'resume_service' || action === 'end_service';
  return true;
}

// ----- Interaction boutons et commandes -----
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  // ----- Commande /createp -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'createp') {
    const embed = new EmbedBuilder()
      .setTitle('🕒 Pointeuse générale')
      .setDescription('Cliquez sur les boutons pour gérer votre service.\nGrades : employe, chef, patron (info seulement)')
      .setColor(0x3498db)
      .setFooter({ text: 'Pointeuse automatique' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pause_service').setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resume_service').setLabel('▶️ Reprendre service').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // ----- Commande /settaux -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'settaux') {
    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    try {
      await axios.post(GOOGLE_WEBHOOK_UPDATE_TAUX, { grade, taux });
      return interaction.reply({ content: `✅ Le taux du grade "${grade}" a été mis à jour à ${taux} €`, ephemeral: true });
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: `❌ Impossible de mettre à jour le taux.`, ephemeral: true });
    }
  }

  // ----- Commande /addgrade -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'addgrade') {
    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    try {
      await axios.post(GOOGLE_WEBHOOK_UPDATE_TAUX, { grade, taux });
      return interaction.reply({ content: `✅ Le grade "${grade}" a été ajouté avec un taux de ${taux} €`, ephemeral: true });
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: `❌ Impossible d'ajouter le grade.`, ephemeral: true });
    }
  }

  // ----- Boutons Start / Pause / Resume / End -----
  if (interaction.isButton() && ['start_service','pause_service','resume_service','end_service'].includes(interaction.customId)) {
    const userId = user.id;

    if (!isActionAllowed(userId, interaction.customId)) {
      return interaction.reply({ content: "❌ Action impossible à ce moment.", ephemeral: true });
    }

    try {
      const grade = "employe"; // ou récupéré dynamiquement depuis le rôle Discord si besoin
      const res = await axios.post(GOOGLE_WEBHOOK, {
        action: interaction.customId.replace('_service',''),
        userId,
        username: user.username,
        grade,
        time: new Date().toISOString()
      });

      const data = res.data;
      if (data.error) return interaction.reply({ content: `❌ ${data.error}`, ephemeral: true });

      let messageText = '';
      const member = interaction.guild.members.cache.get(user.id);
      const displayName = member ? member.displayName : user.username;

      switch(interaction.customId) {
        case 'start_service':
          userState.set(userId, { status: 'active' });
          messageText = `🟢 Service pris ${displayName} ! Bon courage !`;
          break;
        case 'pause_service':
          userState.set(userId, { status: 'pause' });
          messageText = `⏸️ Service en pause ${displayName}, profitez-en pour souffler.`;
          break;
        case 'resume_service':
          userState.set(userId, { status: 'active' });
          messageText = `▶️ Reprise du service ${displayName}, courage !`;
          break;
        case 'end_service':
          userState.set(userId, { status: 'cooldown', cooldownEnd: new Date(Date.now() + 2*60*1000) });
          messageText = null;

          const embed = new EmbedBuilder()
            .setTitle('🧾 Fin de service')
            .setDescription(`Voici le résumé du service de <@${userId}>`)
            .setColor(0x1abc9c)
            .addFields(
                { name: '👤 Employé', value: `<@${userId}>`, inline: true },
                { name: '📅 Date', value: data.date, inline: true },
                { name: '⏱ Durée', value: data.hours, inline: true },
                { name: '💰 Salaire', value: `${data.salary} €`, inline: true }
            )
            .setFooter({ text: 'Pointeuse automatique • Service terminé' })
            .setTimestamp();

          if (userMessages.has(userId)) {
            try { await userMessages.get(userId).delete(); } catch {}
            userMessages.delete(userId);
          }

          return interaction.reply({ embeds: [embed] });
      }

      // Pour Start / Pause / Resume → message public ou update du message existant
      if (messageText) {
        if (userMessages.has(userId)) {
          const msg = userMessages.get(userId);
          await msg.edit({ content: messageText });
        } else {
          const channel = interaction.channel;
          const msg = await channel.send({ content: messageText });
          userMessages.set(userId, msg);
        }
      }

      return interaction.deferUpdate();
    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Erreur serveur. Veuillez réessayer.', ephemeral: true });
    }
  }

  // ----- Bouton Payé -----
  if (interaction.isButton() && interaction.customId.startsWith('paid_')) {
    try { await interaction.message.delete(); } catch {}
  }
});

// ----- Connexion du bot -----
client.login(process.env.TOKEN);

// ----- Serveur Express (Render) -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot Discord en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur le port ${PORT}`));

// ----- Auto Ping pour Render -----
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  axios.get(SELF_URL).then(()=>console.log('🔁 Ping Render OK')).catch(err=>console.error('❌ Ping Render échoué :',err.message));
}, 5*60*1000);
