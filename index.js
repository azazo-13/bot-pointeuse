require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK;

// Bot prêt
client.once('ready', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// Commande /pointeuse
client.on('interactionCreate', async interaction => {
  if (interaction.isChatInputCommand() && interaction.commandName === 'pointeuse') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pause_service').setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resume_service').setLabel('▶️ Reprendre service').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({ content: '🕒 Pointeuse de service', components: [row] });
  }

  // Gestion des boutons
  if (interaction.isButton()) {
    const user = interaction.user;
    const now = new Date();

    const actionMap = {
      start_service: '🟢 Service commencé',
      pause_service: '⏸️ Service mis en pause',
      resume_service: '▶️ Service repris'
    };

    if (interaction.customId in actionMap) {
      await axios.post(GOOGLE_WEBHOOK, { action: interaction.customId.replace('_service',''), userId: user.id, username: user.username, time: now.toISOString() });
      return await interaction.reply({ content: actionMap[interaction.customId], ephemeral: true });
    }

    if (interaction.customId === 'end_service') {
      const res = await axios.post(GOOGLE_WEBHOOK, { action: 'end', userId: user.id, time: now.toISOString() });
      const data = res.data;
      const embed = new EmbedBuilder()
        .setTitle('🧾 Fin de service')
        .addFields(
          { name: 'Employé', value: `<@${user.id}>`, inline: true },
          { name: 'Date', value: data.date, inline: true },
          { name: 'Durée', value: data.hours, inline: true },
          { name: 'Salaire', value: `${data.salary} €`, inline: true }
        )
        .setColor(0x2ecc71);
      await interaction.reply({ embeds: [embed] });
    }
  }
});

// Connexion bot
client.login(process.env.TOKEN);

// Mini serveur Express pour Render
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Discord en ligne ✅'));
app.listen(PORT, () => console.log(`Serveur web minimal lancé sur le port ${PORT}`));
