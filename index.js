// ================== ANTI-CRASH ==================
process.on('uncaughtException', console.error);
process.on('unhandledRejection', console.error);

// ================== IMPORTS ==================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();

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
const BACKUP_INTERVAL = 6 * 60 * 60 * 1000; // 6h
const MAX_BACKUPS = 10;

// ================== INIT FICHIERS ==================

// Dossier backups
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR);
    console.log('📁 Dossier backups créé');
}

// Base SQLite
const db = new sqlite3.Database(DB_FILE, err => {
    if (!err) console.log('🗄️ Base SQLite prête');
});

// ================== INIT DB ==================
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT,
            start INTEGER,
            end INTEGER,
            taux REAL
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS roles (
            role TEXT PRIMARY KEY,
            taux REAL
        )
    `);

    db.run(`
        INSERT OR IGNORE INTO roles (role, taux)
        VALUES ('everyone', 10)
    `);
});

// ================== BACKUP AUTO ==================
function backupDatabase() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(BACKUP_DIR, `backup-${timestamp}.db`);

    fs.copyFile(DB_FILE, file, err => {
        if (err) return console.error('❌ Backup échoué', err);
        cleanupBackups();
        console.log('💾 Backup créé');
    });
}

function cleanupBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.endsWith('.db'))
        .map(f => ({
            name: f,
            time: fs.statSync(path.join(BACKUP_DIR, f)).mtime
        }))
        .sort((a, b) => b.time - a.time);

    files.slice(MAX_BACKUPS).forEach(f => {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    });
}

// Backup au démarrage + intervalle
backupDatabase();
setInterval(backupDatabase, BACKUP_INTERVAL);

// ================== UTILS ==================
const formatDuration = ms => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor(ms % 3600000 / 60000);
    const s = Math.floor(ms % 60000 / 1000);
    return `${h}h ${m}m ${s}s`;
};

// ================== CLIENT DISCORD ==================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// ================== SLASH COMMANDS ==================
const commands = [
    new SlashCommandBuilder()
        .setName('create_pointeuse')
        .setDescription('Créer la pointeuse'),

    new SlashCommandBuilder()
        .setName('add_role')
        .setDescription('Ajouter un rôle avec taux')
        .addStringOption(o => o.setName('role').setRequired(true))
        .addNumberOption(o => o.setName('taux').setRequired(true))
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
    console.log('✅ Slash commands déployées');
})();

// ================== INTERACTIONS ==================
client.on(Events.InteractionCreate, async interaction => {

    // ---------- SLASH ----------
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'create_pointeuse') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start').setLabel('🟢 Début').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('end').setLabel('🔴 Fin').setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setTitle('🕒 Pointeuse')
                .setDescription('Démarrer ou terminer le service')
                .setColor('Blue');

            return interaction.reply({ embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'add_role') {
            db.run(
                `INSERT OR REPLACE INTO roles (role, taux) VALUES (?, ?)`,
                [interaction.options.getString('role'), interaction.options.getNumber('taux')]
            );
            return interaction.reply('✅ Rôle ajouté');
        }
    }

    // ---------- BOUTONS ----------
    if (interaction.isButton()) {
        const uid = interaction.user.id;
        const name = interaction.member.displayName;

        // START
        if (interaction.customId === 'start') {
            db.get(
                `SELECT * FROM sessions WHERE user_id = ? AND end IS NULL`,
                [uid],
                (_, row) => {
                    if (row) {
                        return interaction.reply({
                            content: '⚠️ Tu es déjà en service.',
                            ephemeral: true
                        });
                    }

                    db.get(
                        `SELECT MAX(taux) as taux FROM roles`,
                        [],
                        (_, r) => {
                            const taux = r?.taux || 10;

                            db.run(
                                `INSERT INTO sessions (user_id, start, taux)
                                 VALUES (?, ?, ?)`,
                                [uid, Date.now(), taux]
                            );

                            const embed = new EmbedBuilder()
                                .setTitle('🟢 Début de service')
                                .setDescription(`👤 ${name}\n💶 ${taux}€/h`)
                                .setColor('Green')
                                .setTimestamp();

                            interaction.channel.send({ embeds: [embed] });
                        }
                    );
                }
            );
        }

        // END
        if (interaction.customId === 'end') {
            db.get(
                `SELECT * FROM sessions WHERE user_id = ? AND end IS NULL`,
                [uid],
                (_, session) => {
                    if (!session) return;

                    const end = Date.now();
                    const duration = end - session.start;
                    const pay = (duration / 3600000) * session.taux;

                    db.run(
                        `UPDATE sessions SET end = ? WHERE id = ?`,
                        [end, session.id]
                    );

                    const embed = new EmbedBuilder()
                        .setTitle('🔴 Fin de service')
                        .setColor('Red')
                        .addFields(
                            { name: 'Employé', value: name },
                            { name: 'Durée', value: formatDuration(duration), inline: true },
                            { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true }
                        )
                        .setTimestamp();

                    interaction.channel.send({ embeds: [embed] });
                }
            );
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
