(function(cmd, context) {
    return context.connection.query(`SELECT Id FROM User WHERE Username = '${context.username}'`).then(data => {
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
})
