require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const GOOGLE_WEBHOOK = process.env.GOOGLE_WEBHOOK;

client.once('clientReady', () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
});

// Message de pointeuse
client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const user = interaction.user;
  const now = new Date();

  if (interaction.customId === 'start_service') {
    await axios.post(GOOGLE_WEBHOOK, {
      action: 'start',
      userId: user.id,
      username: user.username,
      time: now.toISOString()
    });

    await interaction.reply({ content: '🟢 Service commencé', ephemeral: true });
  }

  if (interaction.customId === 'end_service') {
    const res = await axios.post(GOOGLE_WEBHOOK, {
      action: 'end',
      userId: user.id,
      time: now.toISOString()
    });

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
});

// Commande pour afficher le menu
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'pointeuse') {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ content: '🕒 Pointeuse de service', components: [row] });
  }
});

client.login(process.env.TOKEN);
