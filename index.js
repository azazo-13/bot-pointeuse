require('dotenv').config();
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

// -------------------- CONFIG --------------------
const REPO = process.env.GITHUB_REPO;          // ex: "username/bot-pointeuse-data"
const BRANCH = process.env.GITHUB_BRANCH || "main";
const FILE_PATH = "data.json";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

// -------------------- STOCKAGE TEMPORAIRE --------------------
const userMessages = new Map(); // pour les embeds
let gradesCache = {};           // grades en cache

// -------------------- UTIL GITHUB --------------------
async function getData() {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`;
  const res = await axios.get(url, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
  const content = Buffer.from(res.data.content, 'base64').toString();
  return { data: JSON.parse(content), sha: res.data.sha };
}

async function saveData(data, sha) {
  const url = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
  const base64Content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  await axios.put(url, {
    message: "Update bot data",
    content: base64Content,
    branch: BRANCH,
    sha: sha
  }, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
}

// -------------------- COMMANDES --------------------
const commands = [
  new SlashCommandBuilder().setName('pointeuse').setDescription('Afficher la pointeuse avec boutons'),
  new SlashCommandBuilder().setName('addgrade').setDescription('Ajouter un nouveau grade')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Taux horaire').setRequired(true)),
  new SlashCommandBuilder().setName('settaux').setDescription('Modifier le taux d’un grade existant')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Nouveau taux').setRequired(true))
].map(cmd => cmd.toJSON());

// -------------------- ENREGISTREMENT COMMANDES --------------------
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Mise à jour des commandes...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Commandes mises à jour');
  } catch (err) {
    console.error('❌ Erreur commandes :', err);
  }
})();

// -------------------- BOT READY --------------------
client.once('ready', async () => {
  console.log(`✅ Connecté en tant que ${client.user.tag}`);
  // Précharger grades
  const { data } = await getData();
  gradesCache = data.grades || { everyone: 6000 };
});

// -------------------- INTERACTIONS --------------------
client.on('interactionCreate', async interaction => {
  try {
    const { data, sha } = await getData(); // récupérer JSON GitHub
    gradesCache = data.grades;

    // -------- COMMANDES SLASH --------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'pointeuse') {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Démarrer').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Terminer').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('payer_service').setLabel('💵 Payer').setStyle(ButtonStyle.Primary)
        );
        return interaction.reply({ content: '🕒 Pointeuse', components: [row] });
      }

      if (interaction.commandName === 'addgrade' || interaction.commandName === 'settaux') {
        if (!interaction.member.permissions.has('Administrator')) return interaction.reply({ content: '❌ Admin uniquement', ephemeral: true });
        const grade = interaction.options.getString('grade');
        const taux = interaction.options.getNumber('taux');

        data.grades[grade] = taux;
        await saveData(data, sha);
        gradesCache = data.grades;

        return interaction.reply({ content: `✅ Grade "${grade}" mis à jour avec ${taux} €/h`, ephemeral: true });
      }
    }

    // -------- BOUTONS --------
    if (interaction.isButton()) {
      const userId = interaction.user.id;
      const userRoles = interaction.member.roles.cache;
      const gradeRoles = Object.keys(gradesCache).filter(g => g !== 'everyone');
      let userGrade = 'everyone';

      // Choisir grade selon rôle le plus haut
      for (const roleName of gradeRoles) {
        const role = userRoles.find(r => r.name === roleName);
        if (role) userGrade = roleName;
      }

      const now = new Date();

      // START
      if (interaction.customId === 'start_service') {
        data.users[userId] = {
          username: interaction.user.username,
          start: now.toISOString(),
          grade: userGrade
        };
        await saveData(data, sha);
        return interaction.reply({ content: `🟢 Service démarré (${userGrade})`, ephemeral: true });
      }

      // END
      if (interaction.customId === 'end_service') {
        const userData = data.users[userId];
        if (!userData || !userData.start) return interaction.reply({ content: '❌ Aucun service en cours', ephemeral: true });

        const start = new Date(userData.start);
        const hours = ((now - start)/3600000).toFixed(2);
        const taux = gradesCache[userData.grade] || gradesCache['everyone'];
        const salary = (hours * taux).toFixed(2);

        userData.end = now.toISOString();
        userData.hours = hours;
        userData.salary = salary;
        await saveData(data, sha);

        const embed = new EmbedBuilder()
          .setTitle('🧾 Fin de service')
          .addFields(
            { name: '👤 Employé', value: `<@${userId}>`, inline: true },
            { name: '⏱ Durée', value: `${hours} h`, inline: true },
            { name: '💰 Salaire', value: `${salary} €`, inline: true },
            { name: '📌 Grade', value: userData.grade, inline: true }
          )
          .setColor(0x2ecc71)
          .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('payer_service').setLabel('💵 Payer').setStyle(ButtonStyle.Primary)
        );

        if (userMessages.has(userId)) try { await userMessages.get(userId).delete(); } catch {}
        const msg = await interaction.reply({ embeds: [embed], components: [row], fetchReply: true });
        userMessages.set(userId, msg);
      }

      // PAYER
      if (interaction.customId === 'payer_service') {
        if (!data.users[userId] || !data.users[userId].salary) return interaction.reply({ content: '❌ Aucun salaire à payer', ephemeral: true });
        delete data.users[userId]; // réinitialiser service terminé
        await saveData(data, sha);
        if (userMessages.has(userId)) try { await userMessages.get(userId).delete(); } catch {}
        return interaction.reply({ content: `💵 Salaire payé pour <@${userId}>`, ephemeral: true });
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) interaction.editReply({ content: '❌ Erreur serveur' });
    else interaction.reply({ content: '❌ Erreur serveur', ephemeral: true });
  }
});

// -------------------- CONNEXION --------------------
client.login(process.env.TOKEN);

// -------------------- EXPRESS / PING --------------------
const express = require('express');
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));
setInterval(() => axios.get(`http://localhost:${PORT}`).catch(()=>{}), 5*60*1000);
