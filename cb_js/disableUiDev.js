(function(cmd, context) {
    return context.autocomplete({
        message: 'Which user do you want to disable ui dev?',
        source: input => {
            let query = 'SELECT Id, Username, Name FROM User WHERE IsActive = true';
            if(input) {
                query += ` AND (Username LIKE '%${input}%' OR Name LIKE '%${input}%')`
            }
            query += ' ORDER BY Username ASC LIMIT 20';
            return context.connection.query(query).then(data => {
                return data.records.map(r => ({ value: r.Username, description: r.Name }));
            });
        },
    }).then(username => {
        return context.connection.query(`SELECT Id FROM User WHERE Username = '${username}'`).then(data => {
            const user = data.records[0];
            return context.connection.metadata.update('MobileSettings', [
                {
                    fullName: 'Mobile',
                    enableS1EncryptedStoragePref2: true,
                }
            ]).then(() => {
                return context.connection.sobject('User').update({
                    Id: user.Id,
                    UserPreferencesUserDebugModePref: false,
                }).then(() => {
                    cmd.logSuccess('Done');
                });
            });
        });
    });
})
