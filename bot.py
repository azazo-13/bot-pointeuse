import discord
from discord.ext import commands, tasks
from discord import app_commands
import json
import datetime
import logging
import os

# --- CONFIGURATION ---
TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID", 0))  # ID du serveur pour slash commands
DATA_FILE = "data.json"
LOG_FILE = "logs.txt"

# --- LOGGING ---
logging.basicConfig(filename=LOG_FILE, level=logging.INFO, 
                    format='%(asctime)s - %(levelname)s - %(message)s')

# --- BOT INIT ---
intents = discord.Intents.default()
intents.message_content = True
intents.members = True
bot = commands.Bot(command_prefix="!", intents=intents)

# --- UTILITAIRES ---
def load_data():
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        logging.warning("Data file not found, creating new one.")
        return {"roles": {}, "active_sessions": {}}

def save_data(data):
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=4)
        logging.info("Data saved.")

def get_user_rate(member):
    data = load_data()
    roles = sorted(member.roles, key=lambda r: r.position, reverse=True)
    for role in roles:
        if role.name in data["roles"]:
            return data["roles"][role.name]
    return 0

# --- SLASH COMMANDS ---
@bot.event
async def on_ready():
    logging.info(f"{bot.user} connected and ready.")
    try:
        synced = await bot.tree.sync()
        logging.info(f"Synced {len(synced)} commands.")
    except Exception as e:
        logging.error(f"Error syncing commands: {e}")

# /add role + taux
@bot.tree.command(name="add", description="Ajouter ou modifier un rôle avec un taux")
@app_commands.describe(role_name="Nom du rôle Discord", rate="Taux par heure")
async def add(interaction: discord.Interaction, role_name: str, rate: float):
    data = load_data()
    if role_name in data["roles"]:
        data["roles"][role_name] = rate
        save_data(data)
        await interaction.response.send_message(f"Rôle **{role_name}** mis à jour avec un taux de {rate}€/h.")
        logging.info(f"Role {role_name} updated to rate {rate}")
    else:
        data["roles"][role_name] = rate
        save_data(data)
        await interaction.response.send_message(f"Rôle **{role_name}** ajouté avec un taux de {rate}€/h.")
        logging.info(f"Role {role_name} added with rate {rate}")

# /creatp
@bot.tree.command(name="creatp", description="Créer une pointeuse")
async def creatp(interaction: discord.Interaction):
    embed = discord.Embed(
        title="Pointeuse",
        description="Cliquez sur 🟢 pour commencer le service et 🔴 pour terminer.",
        color=0x00ff00
    )
    view = discord.ui.View()
    view.add_item(StartButton())
    view.add_item(EndButton())
    await interaction.response.send_message(embed=embed, view=view)
    logging.info("Pointeuse embed created.")

# --- BOUTONS ---
class StartButton(discord.ui.Button):
    def __init__(self):
        super().__init__(style=discord.ButtonStyle.success, label="🟢 Début de service")

    async def callback(self, interaction: discord.Interaction):
        user_id = str(interaction.user.id)
        data = load_data()
        if user_id in data["active_sessions"]:
            await interaction.response.send_message("Vous avez déjà un service en cours.", ephemeral=True)
            logging.warning(f"Double start attempt by {interaction.user.name}")
            return
        
        rate = get_user_rate(interaction.user)
        start_time = datetime.datetime.utcnow().isoformat()
        data["active_sessions"][user_id] = start_time
        save_data(data)

        await interaction.response.send_message(
            f"🟢 Début de service de {interaction.user.name}, taux: {rate}€/h."
        )
        logging.info(f"{interaction.user.name} started service at {start_time} with rate {rate}€/h")

class EndButton(discord.ui.Button):
    def __init__(self):
        super().__init__(style=discord.ButtonStyle.danger, label="🔴 Fin de service")

    async def callback(self, interaction: discord.Interaction):
        user_id = str(interaction.user.id)
        data = load_data()
        if user_id not in data["active_sessions"]:
            await interaction.response.send_message("Vous n'avez pas de service en cours.", ephemeral=True)
            logging.warning(f"End without start attempt by {interaction.user.name}")
            return

        start_time = datetime.datetime.fromisoformat(data["active_sessions"][user_id])
        end_time = datetime.datetime.utcnow()
        duration = end_time - start_time
        hours = duration.total_seconds() / 3600
        rate = get_user_rate(interaction.user)
        pay = round(hours * rate, 2)

        del data["active_sessions"][user_id]
        save_data(data)

        embed = discord.Embed(
            title="🔴 Fin de service",
            description=f"Utilisateur: {interaction.user.name}\nDurée: {str(duration)}\nPaye: {pay}€",
            color=0xff0000
        )
        view = discord.ui.View()
        view.add_item(PayButton())
        await interaction.response.send_message(embed=embed, view=view)
        logging.info(f"{interaction.user.name} ended service. Duration: {duration}, Pay: {pay}€")

class PayButton(discord.ui.Button):
    def __init__(self):
        super().__init__(style=discord.ButtonStyle.primary, label="💰 Payer")

    async def callback(self, interaction: discord.Interaction):
        await interaction.response.send_message("Paye validée. L'embed sera supprimé dans 5 minutes.", ephemeral=True)
        logging.info(f"Paye confirmed for {interaction.user.name}")

        await interaction.message.delete(delay=300)  # Supprime l'embed après 5 min
