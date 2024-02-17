(function(cmd, context) {
    return context.autocomplete({
        message: 'Which user do you want to disable log viewer for?',
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

            return context.connection.query(`SELECT Id FROM practifi__Integration_Log__c WHERE practifi__External_System__c LIKE 'Logger::%'`).then(data => {
                let p = null;
                if(data.records.length) {
                    p = context.connection.sobject('practifi__Integration_Log__c').delete(data.records.map(r => r.Id));
                }
                else {
                    p = Promise.resolve(null);
                }

                return p.then(() => {
                    return context.connection.query(`SELECT Id FROM practifi__PractiFI_Trigger_Setting__c WHERE SetupOwnerId = '${user.Id}'`).then(data => {
                        let setting = data.records[0];
                        let p = null;
                        if(setting) {
                            p = context.connection.sobject('practifi__PractiFI_Trigger_Setting__c').delete(setting.Id);
                        }
                        else {
                            p = Promise.resolve(null);
                        }

                        return p.then(() => {
                            return context.connection.tooling.query(`SELECT Id FROM StaticResource WHERE Name = 'Debug_Enabled'`).then(data => {
                                const sr = data.records[0];
                                let p = null;
                                if(sr) {
                                    p = context.connection.tooling.sobject('StaticResource').delete(sr.Id);
                                }
                                else {
                                    p = Promise.resolve(null);
                                }

                                return p.then(() => {
                                    cmd.logSuccess('LogViewer disabled');
                                });
                            });
                        });
                    });
                });
            });
        });
    });
})
