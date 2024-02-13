(function(cmd, context) {
    const username = context.argv[0];
    let usernamePromise = null;
    if(username) {
        usernamePromise = Promise.resolve(username);
    }
    else {
        usernamePromise = context.autocomplete({
            message: 'Which user do you want to debug?',
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
        });
    }

    return usernamePromise.then(username => {
        return context.connection.query(`SELECT Id, Username FROM User WHERE IsActive = true AND Username = '${username}'`).then(data => {
            const user = data.records[0];
            const userId = user.Id;
            return context.connection.tooling.query(`SELECT Id FROM TraceFlag WHERE TracedEntity.Id = '${userId}' AND LogType = 'USER_DEBUG'`)
                .then(data => {
                    if(data.records.length) {
                        return Promise.all(data.records.map(r => context.connection.tooling.sobject('TraceFlag').destroy(r.Id)));
                    }
                })
                .then(() => {
                    return context.connection.tooling.sobject('DebugLevel').find({ DeveloperName: 'SFDC_DevConsole' });
                })
                .then(debugLevels => {
                    const now = Date.now();

                    return context.connection.tooling.sobject('TraceFlag')
                        .create({
                            StartDate: jsforce.SfDate.toDateTimeLiteral(new Date(now)),
                            ExpirationDate: jsforce.SfDate.toDateTimeLiteral(new Date(now + 30 * 60 * 1000)),
                            LogType: 'USER_DEBUG',
                            TracedEntityId: userId,
                            DebugLevelId: debugLevels[0].Id,
                        });
                })
                .then(() => {
                    cmd.logSuccess('Done. Debug level has been set for 30 mins.');
                });
        });
    });
})
