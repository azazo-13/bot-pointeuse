const { 
  Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
  EmbedBuilder, REST, Routes, SlashCommandBuilder 
} = require('discord.js');
const axios = require('axios');
const express = require('express');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });

// 🔗 Webhook unique Apps Script
const GOOGLE_WEBHOOK = "https://script.google.com/macros/s/AKfycbxpYE6z-UUIsl6GPU-U4wer4BkAAbInL0SHgmnKprihOaB7j63rTMZ8bfdAkW24KN3nCw/exec";

// Stockage temporaire des grades à ajouter ou mettre à jour
const pendingGrades = new Map(); // { grade: taux }

// ----- Commandes slash -----
const commands = [
  new SlashCommandBuilder()
    .setName('createp')
    .setDescription('Créer la pointeuse générale'),

  new SlashCommandBuilder()
    .setName('settaux')
    .setDescription('Modifier le taux d’un grade existant')
    .addStringOption(opt => opt.setName('grade').setDescription('Grade à modifier').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Nouveau taux en €').setRequired(true)),

  new SlashCommandBuilder()
    .setName('addgrade')
    .setDescription('Ajouter un nouveau grade avec son taux')
    .addStringOption(opt => opt.setName('grade').setDescription('Nom du grade').setRequired(true))
    .addNumberOption(opt => opt.setName('taux').setDescription('Taux horaire du grade en €').setRequired(true))
].map(cmd => cmd.toJSON());

// ----- Enregistrement des commandes globales -----
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
  try {
    console.log('🔄 Mise à jour des commandes globales...');
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log('✅ Commandes globales mises à jour : /createp, /settaux, /addgrade');
  } catch (err) {
    console.error('❌ Erreur en enregistrant les commandes :', err);
  }
})();

// ----- Stockage messages et états -----
const userMessages = new Map(); // { userId: message }
const userState = new Map();    // { userId: { status: "active"|"cooldown", cooldownEnd: Date } }

// ----- Vérification des actions autorisées -----
function isActionAllowed(userId, action) {
  const state = userState.get(userId);
  const now = new Date();
  if (!state) return true;
  if (state.status === 'cooldown') {
    if (now < state.cooldownEnd) return false;
    userState.delete(userId);
    return true;
  }
  if (state.status === 'active') return action === 'end_service';
  return true;
}

// ----- Gestion des interactions -----
client.on('interactionCreate', async interaction => {
  const user = interaction.user;

  // ----- /createp -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'createp') {
    const embed = new EmbedBuilder()
      .setTitle('🕒 Pointeuse générale')
      .setDescription('Cliquez sur les boutons pour gérer votre service.\nGrades : employe, chef, patron')
      .setColor(0x3498db)
      .setFooter({ text: 'Pointeuse automatique' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('start_service').setLabel('▶️ Prendre son service').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('end_service').setLabel('⏹️ Fin de service').setStyle(ButtonStyle.Danger)
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  // ----- /addgrade -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'addgrade') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Permission admin requise", flags: 64 });
    }

    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    pendingGrades.set(grade, taux);

    await interaction.reply({ content: `✅ Grade "${grade}" ajouté localement avec un taux de ${taux} €`, flags: 64 });

    flushGradesToGoogleSheet();
  }

  // ----- /settaux -----
  if (interaction.isChatInputCommand() && interaction.commandName === 'settaux') {
    if (!interaction.member.permissions.has("Administrator")) {
      return interaction.reply({ content: "❌ Permission admin requise", flags: 64 });
    }

    const grade = interaction.options.getString('grade');
    const taux = interaction.options.getNumber('taux');

    pendingGrades.set(grade, taux);

    await interaction.reply({ content: `✅ Taux du grade "${grade}" mis à jour localement à ${taux} €`, flags: 64 });

    flushGradesToGoogleSheet();
  }

  // ----- Boutons Start / End / Payer -----
  if (interaction.isButton() && ['start_service','end_service','payer_service'].includes(interaction.customId)) {
    const userId = user.id;

    if (!isActionAllowed(userId, interaction.customId) && interaction.customId !== 'payer_service') {
      return interaction.reply({ content: "❌ Action impossible à ce moment.", ephemeral: true });
    }

    try {
      const grade = "employe"; // par défaut
      if (['start_service','end_service'].includes(interaction.customId)) {
        const res = await axios.post(GOOGLE_WEBHOOK, {
          type: "pointeuse",
          action: interaction.customId.replace('_service',''),
          userId,
          username: user.username,
          grade
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
          case 'end_service':
            userState.set(userId, { status: 'cooldown', cooldownEnd: new Date(Date.now() + 2*60*1000) });

            const embed = new EmbedBuilder()
              .setTitle('🧾 Fin de service')
              .setDescription(`Résumé du service de <@${userId}>`)
              .setColor(0x1abc9c)
              .addFields(
                { name: '👤 Employé', value: `<@${userId}>`, inline: true },
                { name: '📅 Date', value: data.date, inline: true },
                { name: '⏱ Durée', value: data.hours, inline: true },
                { name: '💰 Salaire', value: `${data.salary} €`, inline: true }
              )
              .setFooter({ text: 'Pointeuse automatique • Service terminé' })
              .setTimestamp();

            const payRow = new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('payer_service').setLabel('💵 Payer').setStyle(ButtonStyle.Success)
            );

            if (userMessages.has(userId)) {
              try { await userMessages.get(userId).delete(); } catch {}
              userMessages.delete(userId);
            }

            const msg = await interaction.reply({ embeds: [embed], components: [payRow], fetchReply: true });
            userMessages.set(userId, msg);
            return;
        }

        if (messageText) {
          if (userMessages.has(userId)) {
            const msg = userMessages.get(userId);
            await msg.edit({ content: messageText });
          } else {
            const channel = interaction.channel;
            const msg = await channel.send({ content: messageText });
            userMessages.set(userId, msg);
          }
        }

        return interaction.deferUpdate();
      }

      // ----- Bouton Payer -----
      if (interaction.customId === 'payer_service') {
        if (!userMessages.has(userId)) return interaction.reply({ content: "❌ Aucun service à payer.", ephemeral: true });
        const msg = userMessages.get(userId);
        await msg.delete();
        userMessages.delete(userId);
        return interaction.reply({ content: `💵 Salaire payé pour <@${userId}> !`, ephemeral: true });
      }

    } catch (err) {
      console.error(err);
      return interaction.reply({ content: '❌ Erreur serveur. Veuillez réessayer.', ephemeral: true });
    }
  }

});

// ----- Fonction d'envoi au Google Sheet -----
async function flushGradesToGoogleSheet() {
  if (pendingGrades.size === 0) return;

  for (const [grade, taux] of pendingGrades.entries()) {
    try {
      await axios.post(
        GOOGLE_WEBHOOK,
        { type: "update_taux", grade, taux },
        { headers: { "Content-Type": "application/json" } }
      );
      console.log(`✅ Grade "${grade}" envoyé au Sheet avec taux ${taux}`);
      pendingGrades.delete(grade); // suppression après envoi réussi
    } catch (err) {
      console.error(`❌ Erreur pour grade "${grade}" :`, err.message);
    }
  }
}

// ----- Connexion du bot -----
client.login(process.env.TOKEN);

// ----- Serveur Express pour Render -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot Discord en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur le port ${PORT}`));

// ----- Auto Ping pour Render -----
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
setInterval(() => {
  axios.get(SELF_URL).then(()=>console.log('🔁 Ping Render OK')).catch(err=>console.error('❌ Ping Render échoué :',err.message));
}, 5*60*1000);
