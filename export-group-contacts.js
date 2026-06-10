const fs = require('fs');

function exportGroupContacts() {
    const inputFile = 'group-members-simple.json';
    const outputFile = 'exported-group-contacts.json';

    try {
        const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
        
        console.log('🔄 Exporting group contacts...\n');
        
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
        
        console.log('\n📋 Groups with Contacts:');
        Object.keys(groupContactMap).forEach(groupName => {
            console.log(`   - ${groupName}: ${groupContactMap[groupName].length} contacts`);
        });
        
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

function exportSelectedGroupContacts(groupName) {
    const inputFile = 'group-members-simple.json';
    const outputFile = `exported-group-${groupName.replace(/[^a-zA-Z0-9]/g, '-')}-contacts.json`;

    try {
        const data = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
        
        console.log(`\n🔄 Exporting contacts from group: ${groupName}...\n`);
        
        const selectedGroup = data.groups.find(group => 
            group.groupName === groupName || 
            group.groupId.includes(groupName)
        );
        
        if (!selectedGroup) {
            console.log(`❌ Group not found: ${groupName}`);
            console.log('\n📋 Available Groups:');
            data.groups.forEach(group => {
                console.log(`   - ${group.groupName || 'Unnamed Group'} (${group.groupId})`);
            });
            return;
        }
        
        const groupContacts = selectedGroup.contacts || [];
        
        const finalData = {
            exportedAt: new Date().toISOString(),
            groupName: selectedGroup.groupName || 'Unnamed Group',
            groupId: selectedGroup.groupId,
            summary: {
                totalMembers: selectedGroup.totalMembers || 0,
                contactsExported: groupContacts.length
            },
            groupContacts: groupContacts
        };
        
        fs.writeFileSync(outputFile, JSON.stringify(finalData, null, 2));
        
        console.log(`✅ SUCCESS! Exported ${groupContacts.length} contacts from ${selectedGroup.groupName || 'Unnamed Group'} to ${outputFile}\n`);
        console.log(`📊 Export Summary:`);
        console.log(`   - Group: ${selectedGroup.groupName || 'Unnamed Group'}`);
        console.log(`   - Group ID: ${selectedGroup.groupId}`);
        console.log(`   - Total Members: ${selectedGroup.totalMembers || 0}`);
        console.log(`   - Contacts Exported: ${finalData.summary.contactsExported}`);
        
    } catch (err) {
        console.error('❌ Error:', err);
        process.exit(1);
    }
}

function printHelp() {
    console.log('\n📖 Usage:');
    console.log('   node export-group-contacts.js                    - Export all group contacts');
    console.log('   node export-group-contacts.js <group_name>       - Export contacts from specific group');
    console.log('   node export-group-contacts.js --help             - Show this help message\n');
}

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
    printHelp();
} else if (args.length === 0) {
    exportGroupContacts();
} else {
    const groupName = args[0];
    exportSelectedGroupContacts(groupName);
}
