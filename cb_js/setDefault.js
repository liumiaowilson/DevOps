(function(cmd, context) {
    context.ux.action.start('Loading default');
    return context.connection.describeGlobal().then(data => {
        const keyPrefixMap = {};
        for(const sobject of data.sobjects) {
            keyPrefixMap[sobject.keyPrefix] = sobject.name;
        }

        return context.fs.writeFile('/home/codebuilder/keyPrefix.json', JSON.stringify(keyPrefixMap, null, 4)).then(() => {
            return context.connection.query('SELECT DurableId, DeveloperName FROM AppDefinition').then(data => {
                const appsMap = {};
                for(const record of data.records) {
                    appsMap[record.DeveloperName] = record.DurableId;
                }

                return context.fs.writeFile('/home/codebuilder/apps.json', JSON.stringify(appsMap, null, 4));
            });
        });
    }).finally(() => context.ux.action.stop());
})
