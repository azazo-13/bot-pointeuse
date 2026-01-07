require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { 
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, REST, Routes, SlashCommandBuilder 
} = require('discord.js');

const DATA_PATH = path.join(__dirname, 'data.json');

// ----- Utilitaires JSON -----
function loadData() {
  if (!fs.existsSync(DATA_PATH)) {
    fs.writeFileSync(DATA_PATH, JSON.stringify({ grades: { everyone: 6000 }, services: {} }, null, 2));
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
  } catch (err) {
    console.error('⚠️ Erreur lecture JSON, réinitialisation');
    const initData = { grades: { everyone: 6000 }, services: {} };
    fs.writeFileSync(DATA_PATH, JSON.stringify(initData, null, 2));
    return initData;
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
}

// ----- Initialisation bot -----
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] // nécessaire pour lire les rôles
});

const data = loadData();
const userMessages = new Map();

// ----- Commandes -----
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

// ----- Enregistrement commandes -----
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

// ----- Détection interactions -----
client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;

  // ----- Commandes Slash -----
  if (interaction.isChatInputCommand()) {

    // Menu pointeuse
    if (interaction.commandName === 'pointeuse') {
      await interaction.deferReply({ ephemeral: true });

      const embed = new EmbedBuilder()
        .setTitle('🕒 Pointeuse générale')
        .setDescription('Gérez votre service en cliquant sur les boutons ci-dessous.\n\n**Grades disponibles** : everyone')
        .setColor(0x3498db)
        .setFooter({ text: 'Pointeuse automatique' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({ embeds: [embed], components: [row] });
    }

    // Ajouter grade
    if (interaction.commandName === 'addgrade') {
      if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Permission admin requise', ephemeral: true });
      const grade = interaction.options.getString('grade');
      const taux = interaction.options.getNumber('taux');
      data.grades[grade] = taux;
      saveData(data);
      return interaction.reply({ content: `✅ Grade "${grade}" ajouté avec taux ${taux} €`, ephemeral: true });
    }

    // Modifier taux
    if (interaction.commandName === 'settaux') {
      if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Permission admin requise', ephemeral: true });
      const grade = interaction.options.getString('grade');
      const taux = interaction.options.getNumber('taux');
      if (!data.grades[grade]) return interaction.reply({ content: '❌ Grade inexistant', ephemeral: true });
      data.grades[grade] = taux;
      saveData(data);
      return interaction.reply({ content: `✅ Taux du grade "${grade}" mis à jour à ${taux} €`, ephemeral: true });
    }
  }

  // ----- Boutons -----
  if (!interaction.isButton()) return;

  await interaction.deferUpdate(); // ✅ Évite l'erreur 10062

  const member = await interaction.guild.members.fetch(userId);
  const now = new Date();

  // Déterminer le grade en fonction du rôle le plus haut
  let grade = 'everyone';
  if (member.roles.cache.size > 0) {
    const sortedRoles = member.roles.cache.sort((a,b) => b.position - a.position);
    for (const r of sortedRoles.values()) {
      if (data.grades[r.name]) {
        grade = r.name;
        break;
      }
    }
  }

  // Start service
  if (interaction.customId === 'start_service') {
    if (data.services[userId] && !data.services[userId].end) return interaction.followUp({ content: '❌ Service déjà en cours', ephemeral: true });
    data.services[userId] = { start: now.toISOString(), grade };
    saveData(data);
    return interaction.followUp({ content: `🟢 Service commencé avec grade "${grade}"`, ephemeral: true });
  }

  // End service
  if (interaction.customId === 'end_service') {
    const service = data.services[userId];
    if (!service || service.end) return interaction.followUp({ content: '❌ Aucun service en cours', ephemeral: true });

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

    return interaction.followUp({ embeds: [embed], ephemeral: true });
  }
});

// -------------------- CONNEXION --------------------
client.once('ready', () => console.log(`Connecté en tant que ${client.user.tag}`));
client.login(process.env.TOKEN);

// -------------------- EXPRESS / PING --------------------
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));
setInterval(() => axios.get(`http://localhost:${PORT}`).catch(()=>{}), 5*60*1000);
