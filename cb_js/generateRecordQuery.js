(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    return context.fs.readFile('/home/codebuilder/keyPrefix.json', 'utf8').then(keyPrefixJSON => {
        const prefixMap = JSON.parse(keyPrefixJSON);

        const objectApiName = prefixMap[recordId.substring(0, 3)];
        const queryFile = '/home/codebuilder/DevOps/soql/' + objectApiName + '.soql';

        return context.fs.readFile(queryFile, 'utf8').then(query => {
            query = query.replaceAll('{{recordId}}', recordId);

            cmd.log(query);

            return query;
        });
    });
})
