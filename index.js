const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const fs = require('fs');

// Environment variables
const {
    BOT_TOKEN,
    GUILD_ID,
    LOG_CHANNEL_ID,
    TICKET_CATEGORY_ID,
    PANEL_CHANNEL_ID,
    STAFF_ROLES,
    BANNER_URL = "https://media.discordapp.net/attachments/1480969775344652470/1496647110525845625/DF7E4FDA-66D3-49FF-BD5E-7C746253AE2D.png"
} = process.env;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// Ticket types
const TICKET_TYPES = {
    pub: { name: "🍻 Pub", emoji: "🍻", color: "#00FF00", desc: "General pub discussions" },
    bugs: { name: "🐛 Bugs", emoji: "🐛", color: "#FF0000", desc: "Report a bug or issue" },
    abuse: { name: "⚠️ Abuse", emoji: "⚠️", color: "#FF5500", desc: "Report inappropriate behavior" },
    server: { name: "🛠️ Server", emoji: "🛠️", color: "#0099FF", desc: "Server-related inquiries" }
};

const staffRolesArray = STAFF_ROLES ? STAFF_ROLES.split(',') : [];
const activeTickets = new Map();

// Generate simple transcript
async function generateTranscript(channel) {
    const messages = await channel.messages.fetch({ limit: 100 });
    const sorted = Array.from(messages.values()).reverse();
    
    let transcript = `Ticket Transcript: ${channel.name}\nCreated: ${channel.createdAt}\n\n`;
    for (const msg of sorted) {
        transcript += `[${msg.createdAt.toLocaleString()}] ${msg.author.tag}: ${msg.content || '(embed/attachment)'}\n`;
    }
    
    const filePath = `/tmp/transcript-${channel.id}-${Date.now()}.txt`;
    fs.writeFileSync(filePath, transcript);
    return filePath;
}

// Log to channel
async function log(guild, title, description, color = 0x00ff00) {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;
    
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
}

// Create ticket panel
async function createPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle("🎫 Support Tickets")
        .setDescription("Click a button below to open a ticket. Staff will assist you ASAP.")
        .setColor(0x2b2d31)
        .setImage(BANNER_URL)
        .setFooter({ text: "Support System • 24/7" });

    const row1 = new ActionRowBuilder();
    const row2 = new ActionRowBuilder();
    
    const types = Object.entries(TICKET_TYPES);
    types.forEach(([key, type], i) => {
        const btn = new ButtonBuilder()
            .setCustomId(`ticket_${key}`)
            .setLabel(type.name)
            .setEmoji(type.emoji)
            .setStyle(ButtonStyle.Primary);
        
        i < 2 ? row1.addComponents(btn) : row2.addComponents(btn);
    });
    
    await channel.send({ embeds: [embed], components: [row1, row2] });
}

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    
    const panelChannel = client.channels.cache.get(PANEL_CHANNEL_ID);
    if (panelChannel) {
        await panelChannel.bulkDelete(100).catch(() => {});
        await createPanel(panelChannel);
        console.log("✅ Ticket panel ready!");
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    // Open ticket
    if (interaction.customId.startsWith('ticket_')) {
        const type = interaction.customId.replace('ticket_', '');
        const typeConfig = TICKET_TYPES[type];
        
        // Check existing ticket
        for (const [id, data] of activeTickets) {
            if (data.userId === interaction.user.id) {
                return interaction.reply({ content: "❌ You already have an open ticket! Close it first.", ephemeral: true });
            }
        }
        
        await interaction.reply({ content: "🔄 Creating ticket...", ephemeral: true });
        
        const ticketName = `${type}-${interaction.user.username}`;
        
        try {
            const ticketChannel = await interaction.guild.channels.create({
                name: ticketName,
                type: ChannelType.GuildText,
                parent: TICKET_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
                    ...staffRolesArray.map(roleId => ({ id: roleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }))
                ]
            });
            
            activeTickets.set(ticketChannel.id, { userId: interaction.user.id, type });
            
            const welcomeEmbed = new EmbedBuilder()
                .setTitle(`${typeConfig.emoji} ${typeConfig.name} Ticket`)
                .setDescription(`**Welcome ${interaction.user}!**\n\nType: ${typeConfig.name}\nDescribe your issue. Staff will help you.\n\nClick 🔒 to close.`)
                .setColor(typeConfig.color)
                .setImage(BANNER_URL)
                .setTimestamp();
            
            const closeRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId('close').setLabel('Close Ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('claim').setLabel('Claim Ticket').setEmoji('🎫').setStyle(ButtonStyle.Secondary)
                );
            
            await ticketChannel.send({ 
                content: `${interaction.user} | ${staffRolesArray.map(id => `<@&${id}>`).join(', ')}`,
                embeds: [welcomeEmbed], 
                components: [closeRow] 
            });
            
            await log(interaction.guild, "🎫 Ticket Opened", `**User:** ${interaction.user.tag}\n**Type:** ${typeConfig.name}\n**Channel:** ${ticketChannel}`);
            await interaction.editReply({ content: `✅ Ticket created! ${ticketChannel}`, ephemeral: true });
            
        } catch (err) {
            console.error(err);
            await interaction.editReply({ content: "❌ Failed to create ticket.", ephemeral: true });
        }
    }
    
    // Close ticket
    else if (interaction.customId === 'close') {
        if (!activeTickets.has(interaction.channel.id)) {
            return interaction.reply({ content: "Not a valid ticket.", ephemeral: true });
        }
        
        await interaction.reply({ content: "🔒 Closing ticket in 5 seconds...", ephemeral: false });
        
        const transcriptPath = await generateTranscript(interaction.channel);
        const logChannel = interaction.guild.channels.cache.get(LOG_CHANNEL_ID);
        
        if (logChannel) {
            await logChannel.send({ 
                content: `📄 **Ticket Transcript:** ${interaction.channel.name}`,
                files: [transcriptPath] 
            });
        }
        
        await log(interaction.guild, "🔒 Ticket Closed", `**User:** <@${activeTickets.get(interaction.channel.id).userId}>\n**Closed by:** ${interaction.user.tag}`, 0xff0000);
        
        setTimeout(async () => {
            await interaction.channel.delete();
            activeTickets.delete(interaction.channel.id);
            fs.unlinkSync(transcriptPath);
        }, 5000);
    }
    
    // Claim ticket
    else if (interaction.customId === 'claim') {
        const ticket = activeTickets.get(interaction.channel.id);
        if (!ticket) return interaction.reply({ content: "Invalid ticket.", ephemeral: true });
        
        const isStaff = staffRolesArray.some(roleId => interaction.member.roles.cache.has(roleId));
        if (!isStaff) return interaction.reply({ content: "Only staff can claim tickets.", ephemeral: true });
        
        ticket.claimedBy = interaction.user.id;
        activeTickets.set(interaction.channel.id, ticket);
        
        await interaction.reply({ embeds: [new EmbedBuilder().setTitle("🎫 Ticket Claimed").setDescription(`${interaction.user} is assisting you.`).setColor(0x00ff00)] });
        await log(interaction.guild, "📌 Ticket Claimed", `**Channel:** ${interaction.channel.name}\n**Staff:** ${interaction.user.tag}`, 0x0099ff);
    }
});

client.login(BOT_TOKEN);
