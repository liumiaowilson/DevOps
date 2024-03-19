(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    context.ux.action.start('Loading default');

    return Promise.all([
        context.connection.describeGlobal(),
        context.connection.tooling.describeGlobal(),
        context.connection.query('SELECT DurableId, DeveloperName FROM AppDefinition'),
    ]).then(([ describeGlobal, toolingDescribeGlobal, appData ]) => {
        const keyPrefixMap = {};
        for(const sobject of describeGlobal.sobjects) {
            keyPrefixMap[sobject.keyPrefix] = sobject.name;
        }

        const toolingKeyPrefixMap = {};
        for(const sobject of toolingDescribeGlobal.sobjects) {
            toolingKeyPrefixMap[sobject.keyPrefix] = sobject.name;
        }

        const appsMap = {};
        for(const record of appData.records) {
            appsMap[record.DeveloperName] = record.DurableId;
        }

        return Promise.all([
            context.fs.writeFile(homeDir + '/keyPrefix.json', JSON.stringify(keyPrefixMap, null, 4)),
            context.fs.writeFile(homeDir + '/toolingKeyPrefix.json', JSON.stringify(toolingKeyPrefixMap, null, 4)),
            context.fs.writeFile(homeDir + '/apps.json', JSON.stringify(appsMap, null, 4)),
        ]);
    }).finally(() => context.ux.action.stop());
})
