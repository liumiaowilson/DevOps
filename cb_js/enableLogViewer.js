(function(cmd, context) {
    return context.autocomplete({
        message: 'Which user do you want to enable log viewer for?',
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

            return context.connection.query(`SELECT Id FROM practifi__PractiFI_Trigger_Setting__c WHERE SetupOwnerId = '${user.Id}'`).then(data => {
                let setting = data.records[0];
                let p = null;
                if(setting) {
                    p = context.connection.sobject('practifi__PractiFI_Trigger_Setting__c').update({
                        Id: setting.Id,
                        practifi__Enable_Debug__c: true,
                    });
                }
                else {
                    p = context.connection.sobject('practifi__PractiFI_Trigger_Setting__c').create({
                        SetupOwnerId: user.Id,
                        practifi__Enable_Debug__c: true,
                    });
                }

                return p.then(() => {
                    const json = {
                        "username": username,
                        "sinkType": "IntegrationLog"
                    };

                    return context.connection.tooling.query(`SELECT Id FROM StaticResource WHERE Name = 'Debug_Enabled'`).then(data => {
                        const sr = data.records[0];
                        let p = null;
                        if(sr) {
                            p = context.connection.tooling.sobject('StaticResource').update({
                                Id: sr.Id,
                                Body: Buffer.from(JSON.stringify(json)).toString('base64'),
                            });
                        }
                        else {
                            p = context.connection.tooling.sobject('StaticResource').create({
                                Name: 'Debug_Enabled',
                                ContentType: 'application/json',
                                Body: Buffer.from(JSON.stringify(json)).toString('base64'),
                            });
                        }

                        return p.then(() => {
                            cmd.logSuccess('LogViewer enabled');
                        });
                    });
                });
            });
        });
    });
})
