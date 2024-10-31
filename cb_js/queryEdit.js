(function(cmd, context) {
    return context.mypim.query(`SELECT Id FROM Item__c WHERE Type__c = 'File' AND Name = 'CodeBuilderQueries'`)
        .then(savedQueries => {
            const record = savedQueries.records[0];
            if(record) {
                const url = `${context.mypim.instanceUrl}/lightning/cmp/c__itemEditor?c__type=File&c__recordId=${record.Id}`;
                context.open(url);
            }
            else {
                cmd.log('No saved queries found');
            }
        });
})
