/**
 * fetch-group-members.js
 * Simple version that extracts group details and member information
 */

import makeWASocket, { useMultiFileAuthState } from '@whiskeysockets/baileys';
import fs from 'fs';

const OUTPUT_FILE = 'group-members-simple.json';

async function fetchGroupMembers() {
    console.log('🔄 Starting group members fetch...');

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
            console.log('✅ Connected. Fetching groups...');

            try {
                const chats = await sock.fetchChats();
                console.log(`💬 Found ${chats.length} chats`);

                const groups = await Promise.all(
                    chats
                        .filter(chat => chat.id.endsWith('@g.us'))
                        .map(async (chat) => {
                            try {
                                const participants = await sock.groupFetchAllParticipating(chat.id);
                                return {
                                    groupId: chat.id,
                                    groupName: chat.name || 'Unnamed Group',
                                    totalMembers: participants ? Object.keys(participants).length : 0,
                                    members: (participants ? Object.keys(participants) : []).map(memberId => {
                                        const number = memberId.replace('@s.whatsapp.net', '');
                                        
                                        // Try to get member name from participants data
                                        const participantName = participants?.[memberId]?.name || null;
                                        
                                        return { number, name: participantName };
                                    })
                                };
                            } catch (err) {
                                console.warn(`⚠️ Skipped group ${chat.id}`);
                                return null;
                            }
                        })
                );

                const validGroups = groups.filter(group => group !== null);

                // Enhanced group data with contact export options
                const enhancedGroups = validGroups.map(group => {
                    const contacts = group.members.map(member => ({
                        id: memberId,
                        number: memberId.replace('@s.whatsapp.net', ''),
                        name: member.name || 'Unknown'
                    }));

                    return {
                        ...group,
                        contacts: contacts,
                        exportOptions: {
                            exportGroupContacts: true,
                            exportAllGroupContacts: true
                        }
                    };
                });

                const finalData = {
                    fetchedAt: new Date().toISOString(),
                    summary: {
                        totalGroups: chats.filter(chat => chat.id.endsWith('@g.us')).length,
                        processedGroups: validGroups.length,
                        totalMembers: validGroups.reduce((sum, group) => sum + (group.totalMembers || 0), 0),
                        totalContacts: enhancedGroups.reduce((sum, group) => sum + (group.contacts?.length || 0), 0)
                    },
                    groups: enhancedGroups,
                    exportOptions: {
                        exportAllGroupContacts: true,
                        exportSelectedGroupContacts: true
                    }
                };

                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalData, null, 2));

                console.log(`\n✅ SUCCESS! Saved to ${OUTPUT_FILE}`);
                console.log(`📊 Summary:`);
                console.log(`   - Total Groups Found: ${finalData.summary.totalGroups}`);
                console.log(`   - Groups Processed: ${finalData.summary.processedGroups}`);
                console.log(`   - Total Members: ${finalData.summary.totalMembers}`);
                console.log(`   - Total Contacts: ${finalData.summary.totalContacts}`);
                console.log(`\n📤 Export Options Available:`);
                console.log(`   - Export all group contacts: ${finalData.exportOptions.exportAllGroupContacts ? '✅ Available' : '❌ Not Available'}`);
                console.log(`   - Export selected group contacts: ${finalData.exportOptions.exportSelectedGroupContacts ? '✅ Available' : '❌ Not Available'}`);

                await sock.logout();
                console.log('👋 Logging out...');
                process.exit(0);

            } catch (err) {
                console.error('❌ Error:', err);
                process.exit(1);
            }
        }
    });
}

function showExportMenu() {
    console.log('\n📤 EXPORT OPTIONS:');
    console.log('   1. Export all group contacts (exports all contacts from all groups)');
    console.log('   2. Export contacts from specific group (select a group to export contacts from)');
    console.log('   3. Exit');
    console.log('\n   Enter your choice (1-3): ');
}

function exportAllGroupContacts() {
    console.log('\n🔄 Exporting all group contacts...');
    const outputFile = 'exported-group-contacts.json';
    
    try {
        const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        
        const allGroupContacts = [];
        const groupContactMap = {};
        
        data.groups.forEach(group => {
            const groupName = group.groupName || 'Unnamed Group';
            const groupId = group.groupId;
            const groupContacts = group.contacts || [];
            
            groupContacts.forEach(contact => {
                const contactWithGroup = {
                    ...contact,
                    groupId: groupId,
                    groupName: groupName,
                    exportedAt: new Date().toISOString()
                };
                
                allGroupContacts.push(contactWithGroup);
                groupContactMap[groupName] = groupContactMap[groupName] || [];
                groupContactMap[groupName].push(contactWithGroup);
            });
        });
        
        const finalData = {
            exportedAt: new Date().toISOString(),
            summary: {
                totalGroups: data.summary.totalGroups,
                totalMembers: data.summary.totalMembers,
                totalContactsExported: allGroupContacts.length,
                uniqueGroupsWithContacts: Object.keys(groupContactMap).length
            },
            allGroupContacts: allGroupContacts,
            byGroup: groupContactMap
        };
        
        fs.writeFileSync(outputFile, JSON.stringify(finalData, null, 2));
        
        console.log(`✅ SUCCESS! Exported ${allGroupContacts.length} contacts from ${Object.keys(groupContactMap).length} groups to ${outputFile}\n`);
        console.log(`📊 Export Summary:`);
        console.log(`   - Total Groups: ${data.summary.totalGroups}`);
        console.log(`   - Total Members: ${data.summary.totalMembers}`);
        console.log(`   - Contacts Exported: ${finalData.summary.totalContactsExported}`);
        console.log(`   - Groups with Contacts: ${finalData.summary.uniqueGroupsWithContacts}`);
        
    } catch (err) {
        console.error('❌ Error:', err);
    }
}

function exportSelectedGroupContacts() {
    console.log('\n📋 Available Groups:');
    const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    
    data.groups.forEach((group, index) => {
        console.log(`   ${index + 1}. ${group.groupName || 'Unnamed Group'} (${group.groupId}) - ${group.contacts?.length || 0} contacts`);
    });
    
    console.log('\n   Enter group number to export contacts (or 0 to cancel): ');
}

async function handleExportOptions() {
    const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    const question = (query) => new Promise(resolve => readline.question(query, resolve));
    
    while (true) {
        showExportMenu();
        const choice = await question('');
        
        if (choice === '1') {
            exportAllGroupContacts();
            break;
        } else if (choice === '2') {
            exportSelectedGroupContacts();
            break;
        } else if (choice === '3') {
            console.log('\n👋 Exiting...');
            break;
        } else {
            console.log('\n❌ Invalid choice. Please enter 1, 2, or 3.');
        }
    }
    
    readline.close();
}

fetchGroupMembers().then(() => {
    handleExportOptions().then(() => {
        process.exit(0);
    });
}).catch(console.error);