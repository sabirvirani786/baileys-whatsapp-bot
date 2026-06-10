/**
 * fetch-full-chat-history.js
 * Fetches ALL contacts + chat history with Name + Number + Profile
 */

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import fs from 'fs';

const OUTPUT_FILE = 'whatsapp-full-chat-history.json';
const MESSAGES_PER_CHAT = 30;

async function fetchFullChatHistory() {
    console.log('🔄 Starting full chat history fetch with profiles...');

    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ['Chrome (Linux)', '', ''],
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;

        if (connection === 'open') {
            console.log('✅ Connected. Fetching data...');

            try {
                console.log('\n📥 LOADING CONTACTS...');
                const contacts = await sock.getContacts();
                console.log(`👥 Found ${contacts.length} contacts`);

                const chats = await sock.fetchChats();
                console.log(`💬 Found ${chats.length} chats`);
                
                console.log('\n📤 CONTACT EXPORT OPTIONS:');
                console.log('   1. Export all contacts (exports all contacts from all chats)');
                console.log('   2. Export contacts from specific chat (select a chat to export contacts from)');
                console.log('   3. Skip contact export');
                console.log('\n   Enter your choice (1-3): ');

                const readline = require('readline').createInterface({
                    input: process.stdin,
                    output: process.stdout
                });
                
                const question = (query) => new Promise(resolve => readline.question(query, resolve));
                
                const exportChoice = await question('');
                
                let exportAllContacts = false;
                let exportSpecificChatContacts = false;
                let selectedChatIndex = -1;
                
                if (exportChoice === '1') {
                    exportAllContacts = true;
                    console.log('\n🔄 Exporting all contacts...');
                } else if (exportChoice === '2') {
                    exportSpecificChatContacts = true;
                    console.log('\n📋 Available chats:');
                    chats.forEach((chat, index) => {
                        const isGroup = chat.id.endsWith('@g.us');
                        console.log(`   ${index + 1}. ${chat.name || chat.id} ${isGroup ? '(Group)' : '(Personal)'} - ${contacts.filter(c => c.id === chat.id).length} contacts`);
                    });
                    console.log('\n   Enter chat number to export contacts (or 0 to cancel): ');
                    const chatChoice = await question('');
                    selectedChatIndex = parseInt(chatChoice) - 1;
                    if (selectedChatIndex >= 0 && selectedChatIndex < chats.length) {
                        exportSpecificChatContacts = true;
                        console.log('\n🔄 Exporting contacts from selected chat...');
                    } else {
                        console.log('\n❌ Invalid selection. Skipping contact export.');
                        exportSpecificChatContacts = false;
                    }
                } else {
                    console.log('\n⏭️ Skipping contact export as requested.');
                }

                const chatHistory = [];
                let processed = 0;

                for (const chat of chats) {
                    processed++;
                    console.log(`📥 [${processed}/${chats.length}] ${chat.name || chat.id}`);

                    try {
                        // Get profile picture
                        let profilePic = null;
                        try {
                            profilePic = await sock.profilePictureUrl(chat.id, 'image');
                        } catch {}

                        // Extract number
                        const number = chat.id.replace('@s.whatsapp.net', '').replace('@g.us', '');

                        // Fetch messages
                        const messages = await sock.fetchMessagesFromWA(chat.id, MESSAGES_PER_CHAT);

                        const formattedMessages = messages.map(msg => ({
                            id: msg.key.id,
                            fromMe: msg.key.fromMe,
                            timestamp: msg.messageTimestamp,
                            text: msg.message?.conversation || 
                                  msg.message?.extendedTextMessage?.text || 
                                  (msg.message?.imageMessage ? '[Image]' : 
                                   msg.message?.videoMessage ? '[Video]' : '[Other]')
                        }));

                        chatHistory.push({
                            id: chat.id,
                            number: number,
                            name: chat.name || 'Unknown',
                            profilePicture: profilePic,
                            unreadCount: chat.unreadCount || 0,
                            messageCount: formattedMessages.length,
                            messages: formattedMessages
                        });

                    } catch (err) {
                        console.warn(`⚠️ Skipped: ${chat.id}`);
                    }
                }

                // Count unique personal chats
                const uniquePeople = chatHistory.filter(c => !c.id.endsWith('@g.us'));

                const finalData = {
                    fetchedAt: new Date().toISOString(),
                    summary: {
                        totalContacts: contacts.length,
                        totalChats: chats.length,
                        totalUniquePeopleChatting: uniquePeople.length,
                        totalMessagesFetched: chatHistory.reduce((sum, c) => sum + (c.messages?.length || 0), 0)
                    },
                    contacts: contacts.map(c => ({
                        id: c.id,
                        number: c.id.replace('@s.whatsapp.net', ''),
                        name: c.name || c.notify || 'Unknown'
                    })),
                    chatHistory: chatHistory
                };

                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));

                console.log(`\n✅ SUCCESS! Saved to ${OUTPUT_FILE}`);
                console.log(`📊 Summary:`);
                console.log(`   - Total Contacts: ${finalData.summary.totalContacts}`);
                console.log(`   - Total Chats: ${finalData.summary.totalChats}`);
                console.log(`   - Unique People Chatting: ${finalData.summary.totalUniquePeopleChatting}`);
                console.log(`   - Total Messages: ${finalData.summary.totalMessagesFetched}`);

                // Export contacts if requested
                if (exportAllContacts || exportSpecificChatContacts) {
                    const outputFile = 'exported-contacts.json';
                    
                    const exportData = {
                        exportedAt: new Date().toISOString(),
                        exportType: exportAllContacts ? 'all' : 'specific',
                        summary: {
                            totalContacts: contacts.length,
                            exportAll: exportAllContacts,
                            exportSpecific: exportSpecificChatContacts,
                            selectedChat: exportSpecificChatContacts ? chats[selectedChatIndex]?.name || chats[selectedChatIndex]?.id : null
                        },
                        contacts: exportAllContacts ? 
                            contacts.map(c => ({
                                id: c.id,
                                number: c.id.replace('@s.whatsapp.net', ''),
                                name: c.name || c.notify || 'Unknown'
                            })) : 
                            (exportSpecificChatContacts && selectedChatIndex >= 0 && selectedChatIndex < chats.length) ?
                            contacts.filter(c => c.id === chats[selectedChatIndex].id).map(c => ({
                                id: c.id,
                                number: c.id.replace('@s.whatsapp.net', ''),
                                name: c.name || c.notify || 'Unknown',
                                chatId: chats[selectedChatIndex].id,
                                chatName: chats[selectedChatIndex].name || chats[selectedChatIndex].id
                            })) : []
                    };

                    fs.writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
                    console.log(`\n📤 Exported ${exportData.contacts.length} contacts to ${outputFile}`);
                }

                await sock.logout();
                process.exit(0);

            } catch (err) {
                console.error('❌ Error:', err);
                process.exit(1);
            }
        }
    });
}

fetchFullChatHistory().catch(console.error);