(function(cmd, context) {
    const searchTerm = context.argv[0];
    if(!searchTerm) {
        cmd.error('No user provided');
        return null;
    }

    return context.connection.query(`SELECT Id, Username FROM User WHERE IsActive = true AND Username LIKE '%${searchTerm}%'`).then(data => {
        const users = data.records;
        let userPromise = null;
        if(users.length === 0) {
            cmd.warn('No matching user found');
            return null;
        }
        else if(users.length === 1) {
            userPromise = Promise.resolve(users[0]);
        }
        else {
            userPromise = context.inquirer.prompt([{
                name: 'username',
                message: 'Select a user',
                type: 'list',
                choices: users.map(u => ({ name: u.Username })),
            }]).then(resp => {
                return users.find(u => u.Username === resp.username);
            });
        }

        return userPromise.then(user => {
            return context.connection.metadata.update('SecuritySettings', [
                {
                    fullName: 'SecuritySettings',
                    enableAdminLoginAsAnyUser: true,
                },
            ]).then(() => {
                return context.connection.query(`SELECT Id FROM Organization LIMIT 1`).then(data => {
                    const orgId = data.records[0].Id;
                    const url = `${connection.instanceUrl}/servlet/servlet.su?oid=${orgId}&suorgadminid=${user.Id}&retURL=/005?isUserEntityOverride=1&retURL=%2Fsetup%2Fhome&appLayout=setup&tour=&isdtp=p1&sfdcIFrameOrigin=https%3A%2F%2F${connection.instanceUrl}&sfdcIFrameHost=web&nonce=d6416adec718d525eedb512a964cd39c2125227d8838422d8374667c7b6761eb&clc=1&targetURL=/home/home.jsp&`;

                    context.open(url);

                    return url;
                });
            });
        });
    });
})
