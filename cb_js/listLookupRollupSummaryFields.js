(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Lookup Rollup Summary Fields');
    return context.connection.query(`SELECT Id, NamespacePrefix FROM EntityDefinition WHERE DeveloperName = 'LookupRollupSummary'`).then(data => {
        if(!data.records.length) {
            return [];
        }

        const ns = data.records[0].NamespacePrefix;
        const nsPrefix = ns ? ns + '__' : '';

        return context.connection.query(`SELECT Id, Name, ${nsPrefix}CalculationMode__c FROM ${nsPrefix}LookupRollupSummary__c WHERE ${nsPrefix}ChildObject__c = '${objectApiName}' AND ${nsPrefix}Active__c = true`).then(data => {
            const summaryFields = data.records.map(record => {
                return {
                    id: record.Id,
                    name: record.Name,
                    mode: record[nsPrefix + 'CalculationMode__c'],
                    url: '[m://' + record.Id + ']',
                };
            });

            if(summaryFields.length) {
                cmd.styledHeader('# Lookup Rollup Summary Fields');
                context.ux.table(summaryFields, {
                    name: {},
                    mode: {},
                    url: {},
                });
            }

            return summaryFields;
        });
    }).finally(() => context.ux.action.stop());
})
