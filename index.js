// ================== ANTI-CRASH ==================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================== IMPORTS ==================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');

const {
    Client,
    GatewayIntentBits,
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder
} = require('discord.js');

// ================== CONSTANTES ==================
const PORT = process.env.PORT || 10000;
const DB_FILE = './database.db';
const BACKUP_DIR = './backups';
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000;
const MAX_BACKUPS = 10;

// ================== INIT FICHIERS ==================
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

// ================== SQLITE ==================
const db = new Database(DB_FILE);

// Tables
db.prepare(`
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        start INTEGER,
        end INTEGER,
        taux REAL
    )
`).run();

db.prepare(`
    CREATE TABLE IF NOT EXISTS roles (
        role TEXT PRIMARY KEY,
        taux REAL
    )
`).run();

db.prepare(`
    INSERT OR IGNORE INTO roles (role, taux)
    VALUES ('everyone', 10)
`).run();

// ================== BACKUP AUTO ==================
function backupDatabase() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `backup-${stamp}.db`);

    fs.copyFileSync(DB_FILE, file);
    cleanupBackups();
    console.log('💾 Backup DB OK');
}

function cleanupBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
        }))
        .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUPS).forEach(f =>
        fs.unlinkSync(path.join(BACKUP_DIR, f.name))
    );
}

backupDatabase();
setInterval(backupDatabase, BACKUP_INTERVAL);

// ================== UTILS ==================
const formatDuration = ms => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms % 3600000 / 60000);
    const s = Math.floor(ms % 60000 / 1000);
    return `${h}h ${m}m ${s}s`;
};

// ================== DISCORD CLIENT ==================
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

// ================== SLASH COMMANDS ==================
const commands = [
    new SlashCommandBuilder()
        .setName('create_pointeuse')
        .setDescription('Créer la pointeuse'),

    new SlashCommandBuilder()
    .setName('add_role')
    .setDescription('Ajouter un rôle avec un taux horaire')
    .addStringOption(o =>
        o.setName('role')
         .setDescription('Nom exact du rôle Discord')
         .setRequired(true)
    )
    .addNumberOption(o =>
        o.setName('taux')
         .setDescription('Taux horaire en euros')
         .setRequired(true)
    )
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
    await rest.put(
        Routes.applicationGuildCommands(
            process.env.CLIENT_ID,
            process.env.GUILD_ID
        ),
        { body: commands }
    );
    console.log('✅ Slash commands OK');
})();

// ================== INTERACTIONS ==================
client.on(Events.InteractionCreate, async interaction => {

    // ================== SLASH COMMANDS ==================
    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'create_pointeuse') {
            await interaction.deferReply();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('start')
                    .setLabel('🟢 Début de service')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('end')
                    .setLabel('🔴 Fin de service')
                    .setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setTitle('🕒 Pointeuse')
                .setDescription('Démarrer ou terminer un service')
                .setColor('Blue')
                .setTimestamp();

            return interaction.editReply({
                embeds: [embed],
                components: [row]
            });
        }

        if (interaction.commandName === 'add_role') {
            db.prepare(`
                INSERT OR REPLACE INTO roles (role, taux)
                VALUES (?, ?)
            `).run(
                interaction.options.getString('role'),
                interaction.options.getNumber('taux')
            );

            return interaction.reply('✅ Rôle ajouté');
        }
    }
    // BOUTONS
    if (interaction.isButton()) {
        const uid = interaction.user.id;
        const name = interaction.member.displayName;

        if (interaction.customId === 'start') {
            const open = db.prepare(`
                SELECT 1 FROM sessions
                WHERE user_id = ? AND end IS NULL
            `).get(uid);

            if (open) {
                return interaction.reply({ content: '⚠️ Déjà en service.', ephemeral: true });
            }

            const taux = db.prepare(`
                SELECT MAX(taux) AS taux FROM roles
            `).get().taux || 10;

            db.prepare(`
                INSERT INTO sessions (user_id, start, taux)
                VALUES (?, ?, ?)
            `).run(uid, Date.now(), taux);

            return interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🟢 Début de service')
                        .setDescription(`👤 ${name}\n💶 ${taux}€/h`)
                        .setColor('Green')
                ]
            });
        }

        if (interaction.customId === 'end') {
            const session = db.prepare(`
                SELECT * FROM sessions
                WHERE user_id = ? AND end IS NULL
            `).get(uid);

            if (!session) return;

            const end = Date.now();
            const duration = end - session.start;
            const pay = (duration / 3600000) * session.taux;

            db.prepare(`
                UPDATE sessions SET end = ?
                WHERE id = ?
            `).run(end, session.id);

            return interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('🔴 Fin de service')
                        .setColor('Red')
                        .addFields(
                            { name: 'Employé', value: name },
                            { name: 'Durée', value: formatDuration(duration), inline: true },
                            { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true }
                        )
                ]
            });
        }
    }
});

// ================== READY ==================
client.once(Events.ClientReady, () => {
    console.log(`🤖 Bot connecté : ${client.user.tag}`);
});

// ================== LOGIN ==================
client.login(process.env.TOKEN);

// ================== EXPRESS (RENDER) ==================
const app = express();
app.get('/', (_, res) => res.send('Bot en ligne'));
app.listen(PORT);

setInterval(() => {
    axios.get(`http://localhost:${PORT}`).catch(() => {});
}, 240000);
