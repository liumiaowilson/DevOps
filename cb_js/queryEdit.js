(function(cmd, context) {
    const name = context.argv[0];
    if(!name) {
        cmd.error('Name is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return context.mypim.query(`SELECT Id, Answer__c FROM Item__c WHERE Type__c = 'File' AND Name = 'CodeBuilderQueries'`)
        .then(savedQueries => {
            const record = savedQueries.records[0];
            if(record) {
                const queries = JSON.parse(record.Answer__c || '{}');
                return context.fs.writeFile(homeDir + '/.last_query', queries[name] || '');
            }
            else {
                cmd.log('No saved queries found');
            }
        });
})
