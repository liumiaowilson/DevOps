(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    if(objectApiName !== 'Case') {
        return [];
    }

    context.ux.action.start('Calculating Escalation Rules');
    return context.connection.metadata.list([ { type: 'EscalationRule' } ]).then(data => {
        const result = (Array.isArray(data) ? data : [ data ]).map(record => {
            const [ , name ] = record.fullName.split('.');
            return {
                id: record.id,
                name,
                url: '[m://escalationRule/' + record.id + ']',
            };
        });

        if(result.length) {
            cmd.styledHeader('# Escalation Rules');
            context.ux.table(result, {
                name: {},
                url: {},
            });
        }

        return result;
    }).finally(() => context.ux.action.stop());
})
