(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    if(objectApiName !== 'Case') {
        return [];
    }

    context.ux.action.start('Calculating Entitlement Processes');
    return context.connection.query(`SELECT Id, Name FROM SlaProcess WHERE SobjectType = '${objectApiName}' AND IsActive = true`).then(data => {
        const result = data.records.map(record => {
            return {
                id: record.Id,
                name: record.Name,
                url: '[m://entitlementProcess/' + record.Id + ']',
            };
        });

        if(result.length) {
            cmd.styledHeader('# Entitlement Processes');
            context.ux.table(result, {
                name: {},
                url: {},
            });
        }

        return result;
    }).finally(() => context.ux.action.stop());
 })
