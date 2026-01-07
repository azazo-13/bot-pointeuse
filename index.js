const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// ----------------- Config -----------------
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const DATA_FILE = './data.json';
let data = JSON.parse(fs.readFileSync(DATA_FILE));

// ----------------- Utilitaires -----------------
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function getUserTaux(member) {
    const userRoles = member.roles.cache.map(r => r.name);
    const applicableRoles = userRoles.filter(r => data.roles[r]);
    return applicableRoles.length > 0 ? Math.max(...applicableRoles.map(r => data.roles[r])) : data.roles['everyone'];
}

function formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
}

// ----------------- Commandes slash -----------------
const commands = [
    new SlashCommandBuilder()
        .setName('create_pointeuse')
        .setDescription('Créer une pointeuse avec boutons Start et Fin Service'),

    new SlashCommandBuilder()
        .setName('add_role')
        .setDescription('Ajouter un rôle avec un taux horaire')
        .addStringOption(option =>
            option.setName('role')
                  .setDescription('Nom du rôle Discord')
                  .setRequired(true))
        .addNumberOption(option =>
            option.setName('taux')
                  .setDescription('Taux horaire en €')
                  .setRequired(true)),

    new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Afficher le résumé des heures et payes de tous les utilisateurs')
].map(cmd => cmd.toJSON());

// Déploiement des commandes sur serveur test pour voir immédiatement
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
        // Déploiement instantané sur serveur test
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Commandes slash déployées sur le serveur test !');
    } catch (error) {
        console.error('❌ Erreur lors du déploiement des commandes :', error);
    }
})();

// ----------------- Gestion des interactions -----------------
client.on(Events.InteractionCreate, async interaction => {

    // Commandes slash
    if (interaction.isChatInputCommand()) {

        // Pointeuse
        if (interaction.commandName === 'create_pointeuse') {
            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId('start_service')
                        .setLabel('🟢 Début de service')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('end_service')
                        .setLabel('🔴 Fin de service')
                        .setStyle(ButtonStyle.Danger)
                );

            const embed = new EmbedBuilder()
                .setTitle('🕒 Pointeuse Automatique')
                .setDescription('Cliquez sur **🟢 Début de service** pour commencer et sur **🔴 Fin de service** pour terminer.')
                .setColor('Blue');

            await interaction.reply({ embeds: [embed], components: [row] });
        }

        // Ajouter un rôle
        if (interaction.commandName === 'add_role') {
            const roleName = interaction.options.getString('role');
            const taux = interaction.options.getNumber('taux');

            data.roles[roleName] = taux;
            saveData();
            await interaction.reply(`✅ Le rôle **${roleName}** a été ajouté avec un taux horaire de **${taux}€**.`);
        }

        // Résumé global
        if (interaction.commandName === 'summary') {
            const embed = new EmbedBuilder()
                .setTitle('📊 Résumé des heures et payes')
                .setColor('Green');

            for (const userId in data.users) {
                const sessions = data.users[userId];
                let totalMs = 0;
                let totalPay = 0;

                sessions.forEach(s => {
                    if (s.end) {
                        totalMs += s.end - s.start;
                        totalPay += ((s.end - s.start) / 3600000) * s.taux;
                    }
                });

                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                const username = member ? member.user.username : 'Utilisateur supprimé';

                embed.addFields({
                    name: username,
                    value: `Heures totales : **${(totalMs/3600000).toFixed(2)}h**\nPaye totale : **${totalPay.toFixed(2)}€**`
                });
            }

            await interaction.reply({ embeds: [embed] });
        }
    }

    // Gestion des boutons
    if (interaction.isButton()) {
        const userId = interaction.user.id;
        const username = interaction.user.username;
        const taux = getUserTaux(interaction.member);

        if (interaction.customId === 'start_service') {
            if (!data.users[userId]) data.users[userId] = [];
            data.users[userId].push({ start: Date.now(), end: null, taux });
            saveData();
            await interaction.reply({ content: `🟢 ${username}, votre service a commencé ! Taux horaire : ${taux}€`, ephemeral: true });
        }

        if (interaction.customId === 'end_service') {
            if (!data.users[userId] || data.users[userId].length === 0) {
                return interaction.reply({ content: '⚠️ Vous n\'avez pas de session en cours.', ephemeral: true });
            }
            const session = data.users[userId].find(s => s.end === null);
            if (!session) return interaction.reply({ content: '⚠️ Vous n\'avez pas de session en cours.', ephemeral: true });

            session.end = Date.now();
            const durationMs = session.end - session.start;
            const hoursWorked = durationMs / 3600000;
            const pay = hoursWorked * session.taux;
            saveData();

            const embed = new EmbedBuilder()
                .setTitle(`🔴 Service terminé : ${username}`)
                .setColor('Red')
                .addFields(
                    { name: 'Durée', value: formatDuration(durationMs), inline: true },
                    { name: 'Taux horaire', value: `${session.taux}€`, inline: true },
                    { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true }
                );

            await interaction.reply({ embeds: [embed], ephemeral: true });
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.TOKEN);

// ----------------- Express + Ping Render -----------------
const PORT = process.env.PORT || 3000;
const app = express();

app.get('/', (req, res) => res.status(200).send('🤖 Bot en ligne'));

app.listen(PORT, () => console.log(`🌐 Serveur web actif sur le port ${PORT}`));

// Ping automatique pour éviter la mise en veille
setInterval(() => {
    axios.get(`http://localhost:${PORT}`).catch(() => {});
}, 5 * 60 * 1000);
