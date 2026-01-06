require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK;

// ----- Enregistrement automatique de la commande /pointeuse -----
const commands = [
  new SlashCommandBuilder()
    .setName('pointeuse')
    .setDescription('Ouvre la pointeuse de service')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🔄 Mise à jour des commandes slash...');
    await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );
    console.log('✅ Commandes slash mises à jour');
  } catch (err) {
    console.error('❌ Erreur lors de l’enregistrement des commandes :', err);
  }
})();

// ----- Bot prêt -----
client.once('ready', () => {
  console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

// ----- Gestion des interactions -----
client.on('interactionCreate', async interaction => {
  // Commande /pointeuse
  if (interaction.isChatInputCommand() && interaction.commandName === 'pointeuse') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pause_service').setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resume_service').setLabel('▶️ Reprendre service').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );
    await interaction.reply({ content: '🕒 Pointeuse de service', components: [row] });
  }

  // Boutons
  if (interaction.isButton()) {
    const user = interaction.user;
    const now = new Date();

    const actionMap = {
      start_service: '🟢 Service commencé',
      pause_service: '⏸️ Service mis en pause',
      resume_service: '▶️ Service repris'
    };

    if (interaction.customId in actionMap) {
      await axios.post(GOOGLE_WEBHOOK, {
        action: interaction.customId.replace('_service', ''),
        userId: user.id,
        username: user.username,
        time: now.toISOString()
      });
      return interaction.reply({ content: actionMap[interaction.customId], ephemeral: true });
    }

    if (interaction.customId === 'end_service') {
      const res = await axios.post(GOOGLE_WEBHOOK, { action: 'end', userId: user.id, time: now.toISOString() });
      const data = res.data;
      const embed = new EmbedBuilder()
        .setTitle('🧾 Fin de service')
        .addFields(
          { name: 'Employé', value: `<@${user.id}>`, inline: true },
          { name: 'Date', value: data.date || 'N/A', inline: true },
          { name: 'Durée', value: data.hours || 'N/A', inline: true },
          { name: 'Salaire', value: data.salary ? `${data.salary} €` : 'N/A', inline: true }
        )
        .setColor(0x2ecc71);
      await interaction.reply({ embeds: [embed] });
    }
  }
});

// ----- Connexion du bot -----
client.login(process.env.TOKEN);

// ----- Mini serveur Express pour Render -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => res.send('Bot Discord en ligne ✅'));
app.listen(PORT, () => console.log(`🌐 Serveur web minimal lancé sur le port ${PORT}`));
