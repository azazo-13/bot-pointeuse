require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK;

// Commandes slash
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

// ----- Stockage des messages par utilisateur -----
const userMessages = new Map(); // { userId: message }

client.once('clientReady', () => console.log(`🤖 Connecté en tant que ${client.user.tag}`));

// ----- Stockage de l'état utilisateur -----
const userState = new Map(); // { userId: { status: "active"|"pause"|"cooldown", cooldownEnd: Date } }

// Helper pour vérifier les actions autorisées
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

// ----- Interaction boutons -----
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  // Commande /createP
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
          userState.set(userId, { status: 'cooldown', cooldownEnd: new Date(Date.now() + 2*60*1000) }); // 2 min
          messageText = null; // on supprime le message

          const embed = new EmbedBuilder()
            .setTitle('🧾 Fin de service')
            .setDescription(`Voici le résumé du service de <@${userId}>`)
            .setColor(0x1abc9c) // couleur turquoise douce
            .setThumbnail('https://cdn-icons-png.flaticon.com/512/2920/2920321.png') // icône de salaire / travail
            .addFields(
                { name: '👤 Employé', value: `<@${userId}>`, inline: true },
                { name: '📅 Date', value: data.date, inline: true },
                { name: '⏱ Durée', value: data.hours, inline: true },
                { name: '💰 Salaire', value: `${data.salary} €`, inline: true }
        )
          .setFooter({ text: 'Pointeuse automatique • Service terminé' })
          .setTimestamp();


          const payButton = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`paid_${userId}_${Date.now()}`).setLabel('💰 Payé').setStyle(ButtonStyle.Success)
          );

          // Supprime uniquement le message de l'utilisateur
          if (userMessages.has(userId)) {
            try { await userMessages.get(userId).delete(); } catch{}
            userMessages.delete(userId);
          }

          return interaction.reply({ embeds: [embed], components: [payButton] });
      }

      // Pour Start / Pause / Resume → message public ou update du message existant
      if (messageText) {
        if (userMessages.has(userId)) {
          // Modifier le message existant
          const msg = userMessages.get(userId);
          await msg.edit({ content: messageText });
        } else {
          // Créer un nouveau message et stocker
          const channel = interaction.channel;
          const msg = await channel.send({ content: messageText });
          userMessages.set(userId, msg);
        }
      }

      return interaction.deferUpdate(); // pour retirer le spinner du bouton
    } catch (err) {
      return interaction.reply({ content: '❌ Erreur serveur. Veuillez réessayer.', ephemeral: true });
    }
  }

  // ----- Bouton Payé -----
  if (interaction.isButton() && interaction.customId.startsWith('paid_')) {
    try {
      await interaction.message.delete();
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
