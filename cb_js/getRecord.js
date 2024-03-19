(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Loading');
    return Promise.all([
        context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8'),
        context.fs.readFile(homeDir + '/toolingKeyPrefix.json', 'utf8'),
    ]).then(([ keyPrefixJSON, toolingKeyPrefixJSON ]) => {
        const keyPrefixMap = JSON.parse(keyPrefixJSON);
        const toolingKeyPrefixMap = JSON.parse(toolingKeyPrefixJSON);

        const prefix = recordId.substring(0, 3);
        if(!keyPrefixMap[prefix] && !toolingKeyPrefixMap[prefix]) {
            cmd.error('Unknown record id');
            return;
        }

        const objectApiName = keyPrefixMap[prefix] || toolingKeyPrefixMap[prefix];
        const isTooling = !keyPrefixMap[prefix] && toolingKeyPrefixMap[prefix];
        const connection = isTooling ? context.connection.tooling : context.connection;
        const record = {
            attributes: {
                type: objectApiName,
            },
            Id: recordId,
        };

        return connection.describe(objectApiName).then(objDescribe => {
            if(!objDescribe.queryable) {
                return record;
            }

            const fields = objDescribe.fields.map(field => field.name);
            const query = `SELECT ${fields.join(', ')} FROM ${objectApiName} WHERE Id = '${recordId}'`;
            return connection.query(query).then(data => {
                if(!data.records.length) {
                    return record;
                }

                const result = data.records[0];
                Object.keys(result).forEach(key => {
                    const value = result[key];
                    if(value != null) {
                        record[key] = value;
                    }
                });

                return record;
            });
        });
    }).then(record => {
        cmd.log(JSON.stringify(record, null, 4));

        return record;
    }).finally(() => context.ux.action.stop());
})
