// ================== ANTI-CRASH ==================
process.on('uncaughtException', err => {
    console.error('❌ Uncaught Exception:', err);
});
process.on('unhandledRejection', err => {
    console.error('❌ Unhandled Rejection:', err);
});

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

// ================== CLIENT ==================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
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

// ================== COMMANDES ==================
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
    const channel = interaction.channel;
    const displayName = interaction.member?.displayName || interaction.user.username;

    // ---------- SLASH ----------
    if (interaction.isChatInputCommand()) {

        if (interaction.commandName === 'create_pointeuse') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('start_service').setLabel('🟢 Début de service').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('end_service').setLabel('🔴 Fin de service').setStyle(ButtonStyle.Danger)
            );

            const embed = new EmbedBuilder()
                .setTitle('🕒 Pointeuse')
                .setDescription('🟢 Commencer / 🔴 Terminer le service')
                .setColor('Blue')
                .setTimestamp();

            return interaction.reply({ embeds: [embed], components: [row] });
        }

        if (interaction.commandName === 'add_role') {
            const role = interaction.options.getString('role');
            const taux = interaction.options.getNumber('taux');
            data.roles[role] = taux;
            saveData();
            return interaction.reply(`✅ Rôle **${role}** ajouté (${taux}€/h)`);
        }

        if (interaction.commandName === 'summary') {
            const embed = new EmbedBuilder().setTitle('📊 Résumé').setColor('Green');

            for (const userId in data.users) {
                let totalMs = 0, totalPay = 0;
                data.users[userId].forEach(s => {
                    if (s.end) {
                        totalMs += s.end - s.start;
                        totalPay += ((s.end - s.start) / 3600000) * s.taux;
                    }
                });

                const member = await interaction.guild.members.fetch(userId).catch(() => null);
                embed.addFields({
                    name: member ? member.displayName : 'Utilisateur inconnu',
                    value: `⏱ ${(totalMs / 3600000).toFixed(2)}h\n💰 ${totalPay.toFixed(2)}€`
                });
            }
            return interaction.reply({ embeds: [embed] });
        }
    }

    // ---------- BOUTONS ----------
    if (interaction.isButton()) {

        // ----- START -----
        if (interaction.customId === 'start_service') {
            const taux = getUserTaux(interaction.member);
            if (!data.users[interaction.user.id]) data.users[interaction.user.id] = [];

            const session = { start: Date.now(), end: null, taux };
            data.users[interaction.user.id].push(session);
            saveData();

            const embed = new EmbedBuilder()
                .setTitle(`🟢 Début de service`)
                .setDescription(`👤 ${displayName}\n💶 ${taux}€/h`)
                .setColor('Blue')
                .setTimestamp();

            const msg = await channel.send({ embeds: [embed] });
            session.startMessageId = msg.id;
            saveData();
            return;
        }

        // ----- END -----
        if (interaction.customId === 'end_service') {
            const sessions = data.users[interaction.user.id];
            if (!sessions) return;

            const session = sessions.find(s => !s.end);
            if (!session) return;

            session.end = Date.now();
            saveData();

            if (session.startMessageId) {
                const m = await channel.messages.fetch(session.startMessageId).catch(() => null);
                if (m) await m.delete().catch(() => {});
            }

            const duration = session.end - session.start;
            const pay = (duration / 3600000) * session.taux;

            const embed = new EmbedBuilder()
                .setTitle(`🔴 Service terminé`)
                .setColor('Red')
                .addFields(
                    { name: 'Employé', value: displayName },
                    { name: 'Durée', value: formatDuration(duration), inline: true },
                    { name: 'Paye', value: `${pay.toFixed(2)}€`, inline: true },
                    { name: 'Date', value: `<t:${Math.floor(session.end / 1000)}:F>` }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`valider_paye_${interaction.user.id}`)
                    .setLabel('✅ Valider le paiement')
                    .setStyle(ButtonStyle.Success)
            );

            return channel.send({ embeds: [embed], components: [row] });
        }

        // ----- VALIDATION -----
        if (interaction.customId.startsWith('valider_paye_')) {
            if (!interaction.member.roles.cache.some(r => r.name === 'Patron')) {
                const msg = await channel.send('❌ Seul le patron peut valider.');
                setTimeout(() => msg.delete().catch(() => {}), 2 * 60 * 1000);
                return;
            }

            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor('Green')
                .setFooter({ text: '✅ Paiement validé' })
                .setTimestamp();

            await interaction.update({ embeds: [embed], components: [] });

            setTimeout(async () => {
                const m = await channel.messages.fetch(interaction.message.id).catch(() => null);
                if (m) await m.delete().catch(() => {});
            }, 10 * 60 * 1000);
        }
    }
});

// ================== READY ==================
let botReady = false; // ✅ Déclaration de la variable
client.once(Events.ClientReady, () => {
    console.log(`🤖 Connecté en tant que ${client.user.tag}`);
});

console.log("🔄 Connexion au bot Discord...");
client.login(process.env.TOKEN)
    .then(() => console.log("✅ Login Discord réussi"))
    .catch(err => console.error("❌ Login Discord échoué:", err));

// ================== EXPRESS ==================
const app = express();
const PORT = process.env.PORT || 10000;
// ================== CHECK BOT ==================
setInterval(() => {
    if (!botReady) {
        console.log("⚠️ Bot Discord pas encore prêt...");
    } else {
        console.log(`💓 Bot Discord en ligne (${new Date().toLocaleTimeString()})`);
    }
}, 30000);

app.get('/', (_, res) => res.send('🤖 Bot en ligne'));
app.listen(PORT, () => console.log(`🌐 Serveur actif sur ${PORT}`));

setInterval(() => {
    axios.get(`http://localhost:${PORT}`).catch(() => {});
}, 5 * 60 * 1000);
