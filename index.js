require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { 
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
const express = require('express');
const axios = require('axios');

const DATA_PATH = path.join(__dirname, 'data.json');

// ----- JSON Utils -----
function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ grades: { everyone: 6000 }, services: {} }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ----- Bot Initialization -----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const data = loadData();
const userMessages = new Map();

// ----- Slash Commands -----
const commands = [
  new SlashCommandBuilder()
    .setName('pointeuse')
    .setDescription('Afficher le menu de la pointeuse'),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un nouveau grade')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Taux horaire').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier le taux d’un grade existant')
    .addStringOption(opt => opt.setName('grade').setDescription('Grade à modifier').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Nouveau taux').setRequired(true))
].map(cmd => cmd.toJSON());

// ----- Register Commands -----
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Mise à jour des commandes globales...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Commandes mises à jour');
  } catch (err) {
    console.error(err);
  }
})();

// ----- Interaction Handler -----
client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;
  let member;
  if (interaction.guild) member = await interaction.guild.members.fetch(userId);
  const now = new Date();

  // ---- Slash Commands ----
  if (interaction.isChatInputCommand()) {
    switch(interaction.commandName) {
      case 'pointeuse':
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
        );

        if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
        return interaction.editReply({ content: '🕒 **Pointeuse de service**\nGérez votre service en cliquant sur les boutons ci-dessous.', components: [row] });

      case 'addgrade':
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Permission admin requise', ephemeral: true });
        const gradeAdd = interaction.options.getString('grade');
        const tauxAdd = interaction.options.getNumber('taux');
        data.grades[gradeAdd] = tauxAdd;
        saveData(data);
        return interaction.reply({ content: `✅ Grade "${gradeAdd}" ajouté avec taux ${tauxAdd} €`, ephemeral: true });

      case 'settaux':
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Permission admin requise', ephemeral: true });
        const gradeSet = interaction.options.getString('grade');
        const tauxSet = interaction.options.getNumber('taux');
        if (!data.grades[gradeSet]) return interaction.reply({ content: '❌ Grade inexistant', ephemeral: true });
        data.grades[gradeSet] = tauxSet;
        saveData(data);
        return interaction.reply({ content: `✅ Taux du grade "${gradeSet}" mis à jour à ${tauxSet} €`, ephemeral: true });
    }
  }

  // ---- Buttons ----
  if (!interaction.isButton()) return;

  // Determine grade from roles
  let grade = 'everyone';
  if (member && member.roles.cache.size > 0) {
    const sortedRoles = member.roles.cache.sort((a,b) => b.position - a.position);
    for (const r of sortedRoles.values()) {
      if (data.grades[r.name]) {
        grade = r.name;
        break;
      }
    }
  }

  switch(interaction.customId) {
    case 'start_service':
      if (data.services[userId] && !data.services[userId].end) {
        if (!interaction.replied) return interaction.reply({ content: '❌ Service déjà en cours', ephemeral: true });
        return interaction.followUp({ content: '❌ Service déjà en cours', ephemeral: true });
      }

      data.services[userId] = { start: now.toISOString(), grade };
      saveData(data);

      if (!interaction.deferred) await interaction.deferUpdate();
      return interaction.followUp({ content: `🟢 Service commencé avec grade "${grade}"`, ephemeral: true });

    case 'end_service':
      const service = data.services[userId];
      if (!service || service.end) {
        if (!interaction.replied) return interaction.reply({ content: '❌ Aucun service en cours', ephemeral: true });
        return interaction.followUp({ content: '❌ Aucun service en cours', ephemeral: true });
      }

      service.end = now.toISOString();
      service.hours = ((new Date(service.end) - new Date(service.start)) / 3600000).toFixed(2);
      const taux = data.grades[service.grade] || 6000;
      service.salary = (service.hours * taux).toFixed(2);
      saveData(data);

      const embed = new EmbedBuilder()
        .setTitle('🧾 Fin de service')
        .setColor(0x2ecc71)
        .addFields(
          { name: 'Employé', value: `<@${userId}>`, inline: true },
          { name: 'Grade', value: service.grade, inline: true },
          { name: 'Durée', value: `${service.hours} h`, inline: true },
          { name: 'Salaire', value: `${service.salary} €`, inline: true }
        );

      if (!interaction.deferred) await interaction.deferUpdate();
      return interaction.followUp({ embeds: [embed] });
  }
});

// ----- Bot Connection -----
client.once('ready', () => console.log(`Connecté en tant que ${client.user.tag}`));
client.login(process.env.TOKEN);

// ----- Express Server & Ping for Render -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));
setInterval(() => axios.get(`http://localhost:${PORT}`).catch(()=>{}), 5*60*1000);
