(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    return context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8').then(keyPrefixJSON => {
        const prefixMap = JSON.parse(keyPrefixJSON);

        const objectApiName = prefixMap[recordId.substring(0, 3)];
        const queryFile = homeDir + '/DevOps/soql/' + objectApiName + '.soql';

        return context.fs.readFile(queryFile, 'utf8').then(query => {
            query = query.replaceAll('{{recordId}}', recordId);

            cmd.log(query);

            return query;
        });
    });
})
