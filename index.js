require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK;

// ----- Commandes slash globales -----
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse générale')
].map(cmd => cmd.toJSON());

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

// ----- Bot prêt -----
client.once('clientReady', () => console.log(`🤖 Connecté en tant que ${client.user.tag}`));

// ----- Stockage temporaire -----
const activeMessages = new Map(); // messages éphémères
const userState = new Map();      // état des utilisateurs: active, pause, cooldown

// ----- Helper pour vérifier l'autorisation des actions -----
function isActionAllowed(userId, action) {
  const state = userState.get(userId);
  const now = new Date();

  if (!state) return true; // aucun service actif, Start autorisé

  if (state.status === 'cooldown') {
    if (now < state.cooldownEnd) return false; // bloque tout pendant cooldown
    userState.delete(userId); // cooldown terminé
    return true;
  }

  if (state.status === 'active') {
    return action === 'pause_service' || action === 'end_service';
  }

  if (state.status === 'pause') {
    return action === 'resume_service' || action === 'end_service';
  }

  return true;
}

// ----- Interactions -----
client.on('interactionCreate', async interaction => {
  const user = interaction.user;
  const now = new Date();

  // ----- Commande /createP -----
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

  // ----- Boutons Start / Pause / Resume / End -----
  if (interaction.isButton() && ['start_service','pause_service','resume_service','end_service'].includes(interaction.customId)) {
    const userId = user.id;

    if (!isActionAllowed(userId, interaction.customId)) {
      return interaction.reply({ content: "❌ Action impossible à ce moment.", ephemeral: true });
    }

    try {
      const res = await axios.post(GOOGLE_WEBHOOK, {
        action: interaction.customId.replace('_service',''),
        userId,
        username: user.username,
        time: now.toISOString()
      });

      const data = res.data;
      if (data.error) return interaction.reply({ content: `❌ ${data.error}`, ephemeral: true });

      let rpMessage = '';
      switch(interaction.customId) {
        case 'start_service':
          userState.set(userId, { status: 'active' });
          rpMessage = '🟢 Service pris ! Bon courage !';
          break;
        case 'pause_service':
          userState.set(userId, { status: 'pause' });
          rpMessage = '⏸️ Service en pause, profitez-en pour souffler.';
          break;
        case 'resume_service':
          userState.set(userId, { status: 'active' });
          rpMessage = '▶️ Reprise du service, courage !';
          break;
        case 'end_service':
          userState.set(userId, { status: 'cooldown', cooldownEnd: new Date(Date.now() + 2*60*1000) }); // 2 min cooldown
          rpMessage = '🛑 Fin du service, bonne journée !';

          const embed = new EmbedBuilder()
            .setTitle('🧾 Fin de service')
            .addFields(
              { name: 'Employé', value: `<@${userId}>`, inline: true },
              { name: 'Date', value: data.date, inline: true },
              { name: 'Durée', value: data.hours, inline: true },
              { name: 'Salaire', value: `${data.salary} €`, inline: true }
            )
            .setColor(0x2ecc71);

          const payButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`paid_${userId}_${Date.now()}`).setLabel('💰 Payé').setStyle(ButtonStyle.Success)
          );

          // Supprime tous les messages éphémères de l'utilisateur
          activeMessages.forEach((msg, key) => {
            if (msg.user.id === userId) {
              try { msg.delete?.(); } catch{}
              activeMessages.delete(key);
            }
          });

          return interaction.reply({ content: rpMessage, embeds: [embed], components: [payButton], ephemeral: false });
      }

      // Pour Start / Pause / Resume → message RP éphémère
      const msg = await interaction.reply({ content: rpMessage, ephemeral: true });
      activeMessages.set(interaction.id, interaction);

    } catch (err) {
      return interaction.reply({ content: '❌ Erreur serveur. Veuillez réessayer.', ephemeral: true });
    }
  }

  // ----- Bouton Payé -----
  if (interaction.isButton() && interaction.customId.startsWith('paid_')) {
    try {
      await interaction.message.delete();
      return interaction.reply({ content: '💰 Salaire payé, félicitations !', ephemeral: true });
    } catch {
      return interaction.reply({ content: 'Impossible de supprimer le message.', ephemeral: true });
    }
  }
});

// ----- Connexion -----
client.login(process.env.TOKEN);

// ----- Serveur Express minimal -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Discord en ligne ✅'));
app.listen(PORT, () => console.log(`🌐 Serveur web lancé sur le port ${PORT}`));
