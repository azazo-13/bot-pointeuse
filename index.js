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
        GatewayIntentBits.GuildMembers // Nécessaire pour récupérer les rôles
    ]
});

// ================== DATA ==================
const DATA_FILE = './data.json';

// Vérifie si data.json existe et est valide
let data;
try {
    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(DATA_FILE, JSON.stringify({ roles: { everyone: 10 }, users: {} }, null, 4));
    }
    const raw = fs.readFileSync(DATA_FILE);
    data = JSON.parse(raw);
    if (!data.roles) data.roles = { everyone: 10 };
    if (!data.users) data.users = {};
} catch (err) {
    console.error('❌ Erreur lecture data.json:', err);
    data = { roles: { everyone: 10 }, users: {} };
}

function saveData() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 4));
}

function formatDuration(ms) {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${h}h ${m}m ${s}s`;
}

function getUserTaux(member) {
    if (!member) return data.roles['everyone'];
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

// ================== INTERACTIONS ==================
client.on(Events.InteractionCreate, async interaction => {
    try {
        // ----- Slash Commands -----
        if (interaction.isChatInputCommand()) {
            if (!interaction.guild) {
                return interaction.reply({ content: '⚠️ Cette commande doit être utilisée dans un serveur.', ephemeral: true });
            }

            switch (interaction.commandName) {
                case 'create_pointeuse':
                    await interaction.deferReply();

                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('start_service').setLabel('🟢 Début de service').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('end_service').setLabel('🔴 Fin de service').setStyle(ButtonStyle.Danger)
                    );

                    const embed = new EmbedBuilder()
                        .setTitle('🕒 Pointeuse')
                        .setDescription('🟢 Commencer / 🔴 Terminer le service')
                        .setColor('Blue')
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed], components: [row] });
                    break;

                case 'add_role':
                    const roleName = interaction.options.getString('role');
                    const taux = interaction.options.getNumber('taux');
                    data.roles[roleName] = taux;
                    saveData();
                    await interaction.reply(`✅ Rôle **${roleName}** ajouté (${taux}€/h)`);
                    break;

                case 'summary':
                    const summaryEmbed = new EmbedBuilder().setTitle('📊 Résumé des heures et payes').setColor('Green');
                    for (const userId in data.users) {
                        let totalMs = 0, totalPay = 0;
                        data.users[userId].forEach(s => {
                            if (s.end) {
                                totalMs += s.end - s.start;
                                totalPay += ((s.end - s.start) / 3600000) * s.taux;
                            }
                        });
                        const member = await interaction.guild.members.fetch(userId).catch(() => null);
                        summaryEmbed.addFields({
                            name: member ? member.displayName : 'Utilisateur inconnu',
                            value: `⏱ ${(totalMs / 3600000).toFixed(2)}h\n💰 ${totalPay.toFixed(2)}€`
                        });
                    }
                    await interaction.reply({ embeds: [summaryEmbed] });
                    break;

                default:
                    await interaction.reply({ content: 'Commande inconnue', ephemeral: true });
            }
        }

        // ----- Boutons -----
        if (interaction.isButton()) {
            if (!interaction.member) return;

            const displayName = interaction.member.displayName || interaction.user.username;

            // START SERVICE
            if (interaction.customId === 'start_service') {
                const taux = getUserTaux(interaction.member);
                if (!data.users[interaction.user.id]) data.users[interaction.user.id] = [];
                const session = { start: Date.now(), end: null, taux };
                data.users[interaction.user.id].push(session);
                saveData();

                const embedStart = new EmbedBuilder()
                    .setTitle('🟢 Début de service')
                    .setDescription(`👤 ${displayName}\n💶 ${taux}€/h`)
                    .setColor('Blue')
                    .setTimestamp();

                const msg = await interaction.channel.send({ embeds: [embedStart] });
                session.startMessageId = msg.id;
                saveData();
            }

            // END SERVICE
            if (interaction.customId === 'end_service') {
                const sessions = data.users[interaction.user.id];
                if (!sessions) return;
                const session = sessions.find(s => !s.end);
                if (!session) return;

                session.end = Date.now();
                saveData();

                if (session.startMessageId) {
                    const m = await interaction.channel.messages.fetch(session.startMessageId).catch(() => null);
                    if (m) await m.delete().catch(() => {});
                }

                const duration = session.end - session.start;
                const pay = (duration / 3600000) * session.taux;

                const embedEnd = new EmbedBuilder()
                    .setTitle('🔴 Service terminé')
                    .setColor('Red')
                    .addFields(
                        { name: 'Employé', value: displayName },
                        { name: 'Durée', value: formatDuration(duration), inline: true },
                        { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true },
                        { name: 'Date', value: `<t:${Math.floor(session.end / 1000)}:F>` }
                    )
                    .setFooter({ text: 'Cliquez sur le bouton pour valider le paiement' })
                    .setTimestamp();

                const rowEnd = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`valider_paye_${interaction.user.id}`).setLabel('✅ Valider le paiement').setStyle(ButtonStyle.Success)
                );

                await interaction.channel.send({ embeds: [embedEnd], components: [rowEnd] });
            }

            // VALIDATION PAIEMENT
            if (interaction.customId.startsWith('valider_paye_')) {
                if (!interaction.member.roles.cache.some(r => r.name === 'Patron')) {
                    const msg = await interaction.channel.send('❌ Seul le patron peut valider.');
                    setTimeout(() => msg.delete().catch(() => {}), 2 * 60 * 1000);
                    return;
                }

                const embedValidated = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor('Green')
                    .setFooter({ text: '✅ Paiement validé' })
                    .setTimestamp();

                await interaction.update({ embeds: [embedValidated], components: [] });

                setTimeout(async () => {
                    const m = await interaction.channel.messages.fetch(interaction.message.id).catch(() => null);
                    if (m) await m.delete().catch(() => {});
                }, 10 * 60 * 1000);
            }
        }
    } catch (err) {
        console.error('❌ Erreur interaction:', err);
        if (interaction.isRepliable() && !interaction.replied) {
            await interaction.reply({ content: '⚠️ Une erreur est survenue.', ephemeral: true });
        }
    }
});

// ================== READY ==================
let botReady = false;
client.once(Events.ClientReady, () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}`);
    botReady = true;

    client.on('error', console.error);
    client.on('warn', console.warn);
});

// Vérification du statut toutes les 2 minutes
setInterval(() => {
    if (!botReady) console.log("⚠️ Bot Discord pas encore prêt...");
    else console.log(`💓 Bot Discord en ligne (${new Date().toLocaleTimeString()})`);
}, 120000);

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
