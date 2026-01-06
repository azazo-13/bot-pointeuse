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

// ----- Stockage temporaire des messages -----
const activeMessages = new Map();

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
    try {
      // Envoyer la requête au webhook AppsScript
      const res = await axios.post(GOOGLE_WEBHOOK, {
        action: interaction.customId.replace('_service',''),
        userId: user.id,
        username: user.username,
        time: now.toISOString()
      });

      const data = res.data;

      // Si action impossible
      if (data.error) {
        return interaction.reply({ content: `❌ ${data.error}`, ephemeral: true });
      }

      // ----- Fin de service -----
      if (interaction.customId === 'end_service') {
        const embed = new EmbedBuilder()
          .setTitle('🧾 Fin de service')
          .addFields(
            { name: 'Employé', value: `<@${user.id}>`, inline: true },
            { name: 'Date', value: data.date, inline: true },
            { name: 'Durée', value: data.hours, inline: true },
            { name: 'Salaire', value: `${data.salary} €`, inline: true }
          )
          .setColor(0x2ecc71);

        const payButton = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`paid_${user.id}_${Date.now()}`).setLabel('💰 Payé').setStyle(ButtonStyle.Success)
        );

        // Nettoyer les messages temporaires de l'utilisateur
        activeMessages.forEach((msg, key) => {
          if (msg.user.id === user.id) {
            try { msg.delete?.(); } catch{}
            activeMessages.delete(key);
          }
        });

        return interaction.reply({ embeds: [embed], components: [payButton] });
      }

      // ----- Start / Pause / Resume -----
      activeMessages.set(interaction.id, interaction);
      let rpMessage = "";

switch(interaction.customId) {
  case 'start_service':
    rpMessage = "🟢 Service pris ! Bon courage !";
    break;
  case 'pause_service':
    rpMessage = "⏸️ Service en pause, profitez-en pour souffler.";
    break;
  case 'resume_service':
    rpMessage = "▶️ Reprise du service, courage !";
    break;
  case 'end_service':
    rpMessage = "🛑 Fin du service, bonne journée !";
    break;
}

return interaction.reply({ content: rpMessage, ephemeral: true });


    } catch (err) {
      return interaction.reply({ content: '❌ Erreur serveur. Veuillez réessayer.', ephemeral: true });
    }
  }

  // ----- Bouton Payé -----
  if (interaction.isButton() && interaction.customId.startsWith('paid_')) {
    try {
      await interaction.message.delete();
      await interaction.reply({ content: 'Salaire marqué comme payé ✅', ephemeral: true });
    } catch {
      await interaction.reply({ content: 'Impossible de supprimer le message.', ephemeral: true });
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
