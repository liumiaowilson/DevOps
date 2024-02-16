(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Duplicate Rules');
    return context.connection.query(`SELECT Id, DeveloperName FROM DuplicateRule WHERE SobjectType = '${objectApiName}' AND IsActive = true`).then(data => {
        const result = data.records.map(record => {
            return {
                id: record.Id,
                name: record.DeveloperName,
                url: '[m://duplicateRule/' + record.Id + ']',
            };
        });

        if(result.length) {
            cmd.styledHeader('# Duplicate Rules');
            context.ux.table(result, {
                name: {},
                url: {},
            });
        }

        return result;
    }).finally(() => context.ux.action.stop());
})
