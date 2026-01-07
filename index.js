// ================== ANTI-CRASH ==================
process.on('uncaughtException', err => console.error('❌ Uncaught Exception:', err));
process.on('unhandledRejection', err => console.error('❌ Unhandled Rejection:', err));

// ================== LOG ENV ==================
console.log("TOKEN présent :", process.env.TOKEN ? "OUI" : "NON");
console.log("CLIENT_ID présent :", process.env.CLIENT_ID ? "OUI" : "NON");
console.log("GUILD_ID présent :", process.env.GUILD_ID ? "OUI" : "NON");

// ================== IMPORTS ==================
const fs = require('fs');
const axios = require('axios');
const express = require('express');
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder
} = require('discord.js');
require('dotenv').config();

// ================== CLIENT ==================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers // <- Nécessaire pour les rôles
    ]
});

// ================== DATA ==================
const DATA_FILE = './data.json';
let data = JSON.parse(fs.readFileSync(DATA_FILE));

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function formatDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}h ${m}m ${s}s`;
}

// ================== TAUX HORAIRE ==================
function getUserTaux(member) {
    const roleNames = member.roles.cache.map(r => r.name);
    const rolesValides = roleNames.filter(r => data.roles[r]);
    if (rolesValides.length === 0) return data.roles['everyone'];
    return Math.max(...rolesValides.map(r => data.roles[r]));
}

// ================== COMMANDES SLASH ==================
const commands = [
    new SlashCommandBuilder()
        .setName('create_pointeuse')
        .setDescription('Créer la pointeuse'),
    new SlashCommandBuilder()
        .setName('add_role')
        .setDescription('Ajouter un rôle avec un taux horaire')
        .addStringOption(o => o.setName('role').setDescription('Nom du rôle').setRequired(true))
        .addNumberOption(o => o.setName('taux').setDescription('Taux horaire €').setRequired(true)),
    new SlashCommandBuilder()
        .setName('summary')
        .setDescription('Résumé des heures et payes')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    try {
        console.log('🔄 Déploiement des commandes slash...');
        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands }
        );
        console.log('✅ Commandes slash déployées');
    } catch (e) {
        console.error('❌ Erreur commandes slash:', e);
    }
})();


// ================== READY ==================
let botReady = false;
client.once(Events.ClientReady, () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}`);
    botReady = true;

    client.on('error', console.error);
    client.on('warn', console.warn);
});

// Vérification du statut toutes les 30 secondes
setInterval(() => {
    if (!botReady) {
        console.log("⚠️ Bot Discord pas encore prêt...");
    } else {
        console.log(`💓 Bot Discord en ligne (${new Date().toLocaleTimeString()})`);
    }
}, 30000);

// ================== LOGIN DISCORD ==================
console.log("🔄 Connexion au bot Discord...");
client.login(process.env.TOKEN)
    .then(() => console.log("✅ Login Discord réussi"))
    .catch(err => console.error("❌ Login Discord échoué:", err));

// ================== EXPRESS ==================
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (_, res) => res.send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));

// Ping automatique Render pour éviter la mise en veille
setInterval(() => {
    axios.get(`http://localhost:${PORT}`).catch(() => {});
}, 5 * 60 * 1000);
