const fs = require('fs');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, SlashCommandBuilder, REST, Routes } = require('discord.js');
require('dotenv').config(); // Pour token et client ID
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot Discord actif !');
});

app.listen(PORT, () => {
    console.log(`Serveur web actif sur le port ${PORT}`);
});

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

const DATA_FILE = './data.json';
let data = JSON.parse(fs.readFileSync(DATA_FILE));

// Fonction pour sauvegarder le data.json
function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

// --- Commandes slash ---
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
                  .setRequired(true))
].map(command => command.toJSON());

// Déployer les commandes
const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
(async () => {
    try {
        console.log('Déploiement des commandes slash...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID),
            { body: commands },
        );
        console.log('Commandes slash déployées !');
    } catch (error) {
        console.error(error);
    }
})();

// --- Gestion des interactions ---
client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
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
            await interaction.reply({ content: 'Pointeuse prête ! Cliquez sur les boutons pour démarrer ou terminer votre service.', components: [row] });
        }

        if (interaction.commandName === 'add_role') {
            const roleName = interaction.options.getString('role');
            const taux = interaction.options.getNumber('taux');

            data.roles[roleName] = taux;
            saveData();
            await interaction.reply(`Le rôle **${roleName}** a été ajouté avec un taux horaire de **${taux}€**.`);
        }
    }

    // Gestion des boutons
    if (interaction.isButton()) {
        const userId = interaction.user.id;
        const userName = interaction.user.username;
        const userRoles = interaction.member.roles.cache.map(r => r.name);
        
        // Déterminer le taux horaire à partir des rôles de l'utilisateur
        let applicableRoles = userRoles.filter(r => data.roles[r]);
        let taux = applicableRoles.length > 0 ? Math.max(...applicableRoles.map(r => data.roles[r])) : data.roles['everyone'];

        if (interaction.customId === 'start_service') {
            if (!data.users[userId]) data.users[userId] = [];
            data.users[userId].push({ start: Date.now(), end: null, taux });
            saveData();
            await interaction.reply({ content: `🟢 ${userName}, votre service a commencé ! Taux horaire: ${taux}€`, ephemeral: true });
        }

        if (interaction.customId === 'end_service') {
            if (!data.users[userId] || data.users[userId].length === 0) {
                return interaction.reply({ content: '⚠️ Vous n\'avez pas de session en cours.', ephemeral: true });
            }
            const session = data.users[userId].find(s => s.end === null);
            if (!session) {
                return interaction.reply({ content: '⚠️ Vous n\'avez pas de session en cours.', ephemeral: true });
            }
            session.end = Date.now();
            const hoursWorked = (session.end - session.start) / (1000 * 60 * 60);
            const pay = hoursWorked * session.taux;
            saveData();
            await interaction.reply({ content: `🔴 ${userName}, votre service est terminé.\nHeures travaillées : ${hoursWorked.toFixed(2)}h\nPaye : ${pay.toFixed(2)}€`, ephemeral: true });
        }
    }
});

client.once(Events.ClientReady, () => {
    console.log(`Connecté en tant que ${client.user.tag}`);
});

client.login(process.env.TOKEN);

// ----- Express + Ping Render -----
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req,res) => res.status(200).send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));
setInterval(() => axios.get(`http://localhost:${PORT}`).catch(()=>{}), 5*60*1000);
