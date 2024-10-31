(function(cmd, context) {
    const name = context.argv[0];
    if(!name) {
        cmd.error('Name is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Saving query');
    return Promise.all([
        context.mypim.query(`SELECT Id, Answer__c FROM Item__c WHERE Type__c = 'File' AND Name = 'CodeBuilderQueries'`),
        context.fs.readFile(homeDir + '/.last_query', 'utf8'),
    ]).then(([ savedQueries, lastQuery ]) => {
        lastQuery = lastQuery.trim();
        let record = savedQueries.records[0];
        const queries = JSON.parse(record?.Answer__c || '{}');
        if(lastQuery) {
            queries[name] = lastQuery;
        }

        if(!record) {
            record = {
                Type__c: 'File',
                Name: 'CodeBuilderQueries',
                Source__c: 'CodeBuilderQueries',
                Answer__c: JSON.stringify(queries, null, 4),
            };

            return context.mypim.create('Item__c', record).then(result => result.id);
        }
        else {
            record.Answer__c = JSON.stringify(queries, null, 4);

            return context.mypim.update('Item__c', record).then(result => result.id);
        }
    }).finally(() => context.ux.action.stop());
})
