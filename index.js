require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// ----------------------
// Data store interne
// ----------------------
const dataStore = {
  grades: { everyone: 6000 }, // grade par défaut
  activeServices: {}           // { userId: { start_time, grade, username } }
};

// ----------------------
// Commandes slash
// ----------------------
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse générale'),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un nouveau grade avec son taux')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Taux horaire en €').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier le taux d’un grade existant')
    .addStringOption(opt => opt.setName('grade').setDescription('Grade à modifier').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Nouveau taux en €').setRequired(true))
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Mise à jour des commandes globales...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Commandes globales mises à jour');
  } catch (err) {
    console.error(err);
  }
})();

// ----------------------
// InteractionCreate
// ----------------------
client.on('interactionCreate', async interaction => {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // ----- Commandes slash -----
  if (interaction.isChatInputCommand()) {
    const gradeArg = interaction.options?.getString('grade');
    const tauxArg = interaction.options?.getNumber('taux');

    if (interaction.commandName === 'createp') {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
      );
      return interaction.reply({ content: '🕒 Pointeuse de service', components: [row] });
    }

    if (interaction.commandName === 'addgrade') {
      if (!interaction.member.permissions.has("Administrator")) return interaction.reply({ content: '❌ Admin requis', ephemeral: true });
      dataStore.grades[gradeArg] = tauxArg;
      return interaction.reply({ content: `✅ Grade "${gradeArg}" ajouté avec taux ${tauxArg} €`, ephemeral: true });
    }

    if (interaction.commandName === 'settaux') {
      if (!interaction.member.permissions.has("Administrator")) return interaction.reply({ content: '❌ Admin requis', ephemeral: true });
      if (!dataStore.grades[gradeArg]) return interaction.reply({ content: '❌ Grade inexistant', ephemeral: true });
      dataStore.grades[gradeArg] = tauxArg;
      return interaction.reply({ content: `✅ Taux du grade "${gradeArg}" mis à jour à ${tauxArg} €`, ephemeral: true });
    }
  }

  // ----- Boutons -----
  if (interaction.isButton()) {
    const memberRoles = interaction.member.roles.cache.map(r => r.name);
    // Déterminer le grade Discord le plus prioritaire
    const grade = Object.keys(dataStore.grades).find(g => memberRoles.includes(g)) || 'everyone';

    // --- START SERVICE ---
    if (interaction.customId === 'start_service') {
      if (dataStore.activeServices[userId]) return interaction.reply({ content: '❌ Service déjà actif', ephemeral: true });
      dataStore.activeServices[userId] = { start_time: new Date(), grade, username };
      return interaction.reply({ content: `🟢 Service commencé (${grade})`, ephemeral: true });
    }

    // --- END SERVICE ---
    if (interaction.customId === 'end_service') {
      const service = dataStore.activeServices[userId];
      if (!service) return interaction.reply({ content: '❌ Aucun service actif', ephemeral: true });

      const end_time = new Date();
      const hours = ((end_time - service.start_time)/3600000).toFixed(2);
      const salaire = (hours * dataStore.grades[service.grade]).toFixed(2);

      const embed = new EmbedBuilder()
        .setTitle('🧾 Fin de service')
        .setColor(0x2ecc71)
        .addFields(
          { name: 'Employé', value: `<@${userId}>`, inline: true },
          { name: 'Date', value: new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), inline: true },
          { name: 'Durée', value: `${hours} h`, inline: true },
          { name: 'Salaire', value: `${salaire} €`, inline: true }
        );

      delete dataStore.activeServices[userId];
      return interaction.reply({ embeds: [embed] });
    }
  }
});

// ----------------------
// Connexion et Express pour Render
// ----------------------
client.login(process.env.TOKEN);

const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot Discord en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur le port ${PORT}`));

// Ping automatique Render
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  require('axios').get(SELF_URL).then(()=>console.log('🔁 Ping OK')).catch(e=>console.error('❌ Ping échoué', e.message));
}, 5*60*1000);
