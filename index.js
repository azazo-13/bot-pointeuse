const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} = require('discord.js');

const axios = require('axios');
const express = require('express');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ================= CONFIG =================
const GOOGLE_WEBHOOK = "TON_URL_APP_SCRIPT_ICI";
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ================= STOCKAGE =================
const pendingGrades = new Map(); // grade => taux
const userState = new Map();     // userId => { status, cooldownEnd }

// ================= COMMANDES SLASH =================
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse'),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un grade')
    .addStringOption(o => o.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(o => o.setName('taux').setDescription('Taux horaire').setRequired(true)),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier un taux')
    .addStringOption(o => o.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(o => o.setName('taux').setDescription('Nouveau taux').setRequired(true))
].map(c => c.toJSON());

// ================= REGISTER COMMANDS =================
const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Commandes enregistrées');
})();

// ================= UTILS =================
function canDo(userId, action) {
  const state = userState.get(userId);
  const now = Date.now();

  if (!state) return action === 'start';

  if (state.status === 'cooldown') {
    if (now < state.cooldownEnd) return false;
    userState.delete(userId);
    return action === 'start';
  }

  if (state.status === 'active') {
    return action === 'pause' || action === 'end';
  }

  if (state.status === 'pause') {
    return action === 'resume' || action === 'end';
  }

  return false;
}

// ================= INTERACTIONS =================
client.on('interactionCreate', async interaction => {

  // ---------- /createp ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'createp') {
    const embed = new EmbedBuilder()
      .setTitle('🕒 Pointeuse')
      .setDescription('Utilisez les boutons ci-dessous')
      .setColor(0x3498db);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start').setLabel('▶️ Prendre service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('pause').setLabel('⏸️ Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('resume').setLabel('▶️ Reprendre').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('end').setLabel('⏹️ Fin service').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // ---------- /addgrade ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'addgrade') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Admin requis", flags: 64 });
    }

    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    pendingGrades.set(grade, taux);
    await interaction.reply({ content: `✅ Grade ${grade} ajouté (${taux} €)`, flags: 64 });
    flushGrades();
  }

  // ---------- /settaux ----------
  if (interaction.isChatInputCommand() && interaction.commandName === 'settaux') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Admin requis", flags: 64 });
    }

    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    pendingGrades.set(grade, taux);
    await interaction.reply({ content: `✅ Taux ${grade} mis à ${taux} €`, flags: 64 });
    flushGrades();
  }

  // ---------- BOUTONS SERVICE ----------
  if (interaction.isButton() && ['start','pause','resume','end'].includes(interaction.customId)) {
    const userId = interaction.user.id;
    const action = interaction.customId;

    if (!canDo(userId, action)) {
      return interaction.reply({ content: "❌ Action impossible", flags: 64 });
    }

    try {
      const res = await axios.post(GOOGLE_WEBHOOK, {
        type: "pointeuse",
        action,
        userId,
        username: interaction.user.username,
        grade: "employe"
      });

      const data = res.data;
      if (data.error) throw new Error(data.error);

      if (action === 'start') userState.set(userId, { status: 'active' });
      if (action === 'pause') userState.set(userId, { status: 'pause' });
      if (action === 'resume') userState.set(userId, { status: 'active' });

      if (action === 'end') {
        userState.set(userId, {
          status: 'cooldown',
          cooldownEnd: Date.now() + 120000
        });

        const embed = new EmbedBuilder()
          .setTitle('🧾 Fin de service')
          .addFields(
            { name: 'Employé', value: `<@${userId}>`, inline: true },
            { name: 'Date', value: data.date, inline: true },
            { name: 'Heures', value: `${data.hours}`, inline: true },
            { name: 'Salaire', value: `${data.salary} €`, inline: true }
          )
          .setColor(0x1abc9c)
          .setFooter({ text: 'En attente de paiement' });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`pay_${userId}`)
            .setLabel('💸 Payer')
            .setStyle(ButtonStyle.Success)
        );

        return interaction.reply({ embeds: [embed], components: [row] });
      }

      return interaction.deferUpdate();

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: "❌ Erreur serveur", flags: 64 });
    }
  }

  // ---------- BOUTON PAYER ----------
  if (interaction.isButton() && interaction.customId.startsWith('pay_')) {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Admin requis", flags: 64 });
    }

    await interaction.message.delete();
    return interaction.reply({ content: "✅ Paye validée", flags: 64 });
  }
});

// ================= GOOGLE SHEET =================
async function flushGrades() {
  for (const [grade, taux] of pendingGrades) {
    try {
      await axios.post(GOOGLE_WEBHOOK, {
        type: "update_taux",
        grade,
        taux
      });
      pendingGrades.delete(grade);
    } catch (err) {
      console.error("Erreur Google Sheet :", err.message);
    }
  }
}

// ================= BOT =================
client.login(TOKEN);

// ================= EXPRESS (RENDER) =================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (_, res) => res.send('Bot en ligne'));
app.listen(PORT, () => console.log('🌐 Serveur actif'));

// Auto-ping Render
setInterval(() => {
  axios.get(process.env.RENDER_EXTERNAL_URL).catch(() => {});
}, 300000);
