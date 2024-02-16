(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    if(![ 'Case', 'Lead' ].includes(objectApiName)) {
        return [];
    }

    context.ux.action.start('Calculating AutoResponse Rules');
    return context.connection.tooling.query(`SELECT Id, Name FROM AutoResponseRule WHERE EntityDefinitionId = '${objectApiName}' AND Active = true`).then(data => {
        const result = data.records.map(record => {
            return {
                id: record.Id,
                name: record.Name,
                url: '[m://autoResponseRule/' + objectApiName + '/' + record.Id + ']',
            };
        });

        if(result.length) {
            cmd.styledHeader('# Auto Response Rules');
            context.ux.table(result, {
                name: {},
                url: {},
            });
        }

        return result;
    });
})
