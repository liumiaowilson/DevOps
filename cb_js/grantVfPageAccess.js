(function(cmd, context) {
    const pageName = context.argv[0];
    if(!pageName) {
        cmd.error('Page Name is required');
        return;
    }

    return context.autocomplete({
        message: 'Which user do you want to grant access to?',
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
        return Promise.all([
            context.connection.query(`SELECT Id, NamespacePrefix FROM Organization LIMIT 1`),
            context.connection.query(`SELECT Id, Username FROM User WHERE IsActive = true AND Username = '${username}'`)
        ]).then(([ orgData, userData ]) => {
            const user = userData.records[0];

            const ns = orgData.records[0].NamespacePrefix;
            const nsPrefix = ns ? ns + '__' : '';

            const permName = pageName + 'Perm';
            return connection.metadata.upsert('PermissionSet', [
                {
                    fullName: `${nsPrefix}${permName}`,
                    label: permName,
                    pageAccesses: {
                        apexPage: `${nsPrefix}${pageName}`,
                        enabled: true,
                    },
                },
            ]).then(() => {
                return Promise.all([
                    connection.query(`SELECT Id FROM PermissionSet WHERE Name = '${permName}'`).then(data => data.records[0].Id),
                ]).then(([permissionSetId]) => {
                    return connection.sobject('PermissionSetAssignment').insert([
                        {
                            AssigneeId: user.Id,
                            PermissionSetId: permissionSetId,
                        },
                    ]).then(() => {
                        cmd.logSuccess('Done');
                    });
                });
            });
        });
    });
})
