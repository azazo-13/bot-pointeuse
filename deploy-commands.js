const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

// Définition des commandes
const commands = [
  new SlashCommandBuilder()
    .setName("creatp")
    .setDescription("Créer la pointeuse")
].map(cmd => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("⏳ Enregistrement des commandes GUILD...");
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Commandes GUILD enregistrées");

    console.log("⏳ Enregistrement des commandes GLOBAL...");
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("✅ Commandes GLOBAL enregistrées");

  } catch (error) {
    console.error("❌ Erreur commandes :", error);
  }
})();
