(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Retrieving record');
    return context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8').then(keyPrefixJSON => {
        const keyPrefixMap = JSON.parse(keyPrefixJSON);
        const objectApiName = keyPrefixMap[recordId.substring(0, 3)];
        return context.connection.describe(objectApiName).then(describe => {
            return context.connection.query(`SELECT ${describe.fields.map(field => field.name).join(',')} FROM ${objectApiName} WHERE Id = '${recordId}'`).then(data => {
                const record = data.records[0];
                if(!record) {
                    cmd.error('No such record found');
                    return;
                }

                const {
                    attributes,
                    ...result
                } = record;

                cmd.log(JSON.stringify(result, (key, value) => {
                    if(value === null) {
                        return undefined;
                    }

                    if(typeof value === 'string') {
                        if((value.startsWith('{') && value.endsWith('}')) ||
                            (value.startsWith('[') && value.endsWith(']'))) {
                            try {
                                value = JSON.parse(value);
                            }
                            catch(e) {
                            }
                        }
                    }

                    return value;
                }, 4));

                return result;
            });
        });
    }).finally(() => context.ux.action.stop());
})
