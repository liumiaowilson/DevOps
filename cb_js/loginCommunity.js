(function(cmd, context) {
    return context.autocomplete({
        message: 'Which community do you want to login?',
        source: input => {
            let query = 'SELECT Id, Name FROM Network';
            if(input) {
                query += ` WHERE Name LIKE '%${input}%'`
            }
            query += ' ORDER BY Name ASC LIMIT 20';
            return context.connection.query(query).then(data => {
                return data.records.map(r => ({ value: r.Name, description: r.Name }));
            });
        },
    }).then(networkName => {
        return context.autocomplete({
            message: 'Which user do you want to login?',
            source: input => {
                let query = 'SELECT Id, Username, ContactId FROM User WHERE IsActive = true AND ContactId != null';
                if(input) {
                    query += ` AND Username LIKE '%${input}%'`
                }
                query += ' ORDER BY Username ASC LIMIT 20';
                return context.connection.query(query).then(data => {
                    return data.records.map(r => ({ value: r.Username, description: r.Username }));
                });
            },
        }).then(username => {
            return Promise.all([
                context.connection.query(`SELECT Id FROM Network WHERE Name = '${networkName}'`),
                context.connection.query(`SELECT Id, ContactId FROM User WHERE Username = '${username}'`),
                context.connection.query(`SELECT Id FROM Organization`),
            ]).then(([ networkData, userData, orgData ]) => {
                const networkId = networkData.records[0].Id;
                const userId = userData.records[0].Id;
                const contactId = userData.records[0].ContactId;
                const orgId = orgData.records[0].Id;

                const url = `${context.connection.instanceUrl}/servlet/servlet.su?oid=${orgId}&retURL=%2F${contactId}&sunetworkid=${networkId}&sunetworkuserid=${userId}`;
                context.open(url);

                return url;
            });
        });
    });
})
