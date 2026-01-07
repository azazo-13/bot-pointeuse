const fs = require('fs');
const axios = require('axios');
const express = require('express');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
require('dotenv').config();

// ----------------- Config -----------------
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const DATA_FILE = './data.json';
let data = JSON.parse(fs.readFileSync(DATA_FILE));

// ----------------- Utilitaires -----------------
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

// Récupérer le taux horaire basé uniquement sur les rôles enregistrés
function getUserTaux(member) {
    const userRoles = member.roles.cache.map(r => r.name);
    const applicableRoles = userRoles.filter(r => data.roles[r]);
    return applicableRoles.length > 0 ? Math.max(...applicableRoles.map(r => data.roles[r])) : data.roles['everyone'];
}

// Formater la durée en h m s
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

// Déploiement des commandes sur serveur test
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
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

    // ---------------- Commandes slash ----------------
    if (interaction.isChatInputCommand()) {
        const displayName = interaction.member.displayName;

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

        if (interaction.commandName === 'add_role') {
            const roleName = interaction.options.getString('role');
            const taux = interaction.options.getNumber('taux');

            data.roles[roleName] = taux;
            saveData();
            await interaction.reply(`✅ Le rôle **${roleName}** a été ajouté avec un taux horaire de **${taux}€**.`);
        }

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
                const name = member ? member.displayName : 'Utilisateur supprimé';

                embed.addFields({
                    name,
                    value: `Heures totales : **${(totalMs/3600000).toFixed(2)}h**\nPaye totale : **${totalPay.toFixed(2)}€**`
                });
            }

            await interaction.reply({ embeds: [embed] });
        }
    }

    // ---------------- Gestion des boutons ----------------
    if (interaction.isButton()) {
        const userId = interaction.user.id;
        const displayName = interaction.member.displayName;
        const taux = getUserTaux(interaction.member);
        const channel = interaction.channel; // canal actuel

        // --- Début de service ---
        if (interaction.customId === 'start_service') {
            if (!data.users[userId]) data.users[userId] = [];
            const session = { start: Date.now(), end: null, taux };
            data.users[userId].push(session);
            saveData();

            const message = await channel.send(`🟢 **${displayName}** a commencé son service. Taux horaire : ${taux}€`);
            session.startMessageId = message.id;
            saveData();

            return interaction.reply({ content: `🟢 ${displayName}, votre service a commencé !`, ephemeral: true });
        }

        // --- Fin de service ---
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

            // Supprimer message début de service
            if (session.startMessageId) {
                const startMessage = await channel.messages.fetch(session.startMessageId).catch(() => null);
                if (startMessage) await startMessage.delete().catch(() => {});
            }

            // Embed fin de service avec bouton validation
            const embed = new EmbedBuilder()
                .setTitle(`🔴 Service terminé : ${displayName}`)
                .setColor('Red')
                .addFields(
                    { name: 'Durée', value: formatDuration(durationMs), inline: true },
                    { name: 'Taux horaire', value: `${session.taux}€`, inline: true },
                    { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true }
                )
                .setFooter({ text: 'Cliquer sur le bouton pour valider le paiement' });

            const row = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`valider_paye_${userId}_${Date.now()}`)
                        .setLabel('✅ Valider le paiement')
                        .setStyle(ButtonStyle.Success)
                );

            await channel.send({ embeds: [embed], components: [row] });
            return interaction.reply({ content: `🔔 ${displayName}, votre fin de service a été envoyée au patron pour validation.`, ephemeral: true });
        }

        // --- Validation par le patron ---
        if (interaction.customId.startsWith('valider_paye_')) {
            if (!interaction.member.roles.cache.some(r => r.name === 'Admin')) {
                return interaction.reply({ content: '❌ Seul le patron peut valider le paiement.', ephemeral: true });
            }

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('Green')
                .setFooter({ text: '✅ Paiement validé par le patron' });

            await interaction.update({ embeds: [embed], components: [] });
        }
    }
});

// ----------------- Bot Ready -----------------
client.once(Events.ClientReady, () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.TOKEN);

// ----------------- Express + ping Render -----------------
const PORT = process.env.PORT || 3000;
const app = express();

app.get('/', (req, res) => res.status(200).send('🤖 Bot en ligne'));

app.listen(PORT, () => console.log(`🌐 Serveur web actif sur le port ${PORT}`));

setInterval(() => {
    axios.get(`http://localhost:${PORT}`).catch(() => {});
}, 5 * 60 * 1000);
