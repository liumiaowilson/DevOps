(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    if(![ 'Case', 'Lead' ].includes(objectApiName)) {
        return;
    }

    return context.connection.query(`SELECT Id, Name FROM AssignmentRule WHERE SobjectType = '${objectApiName}' AND Active = true`).then(data => {
        const result = data.records.map(record => {
            return {
                id: record.Id,
                name: record.Name,
                url: '[m://assignmentRule/' + objectApiName + '/' + record.Id + ']',
            };
        });

        if(result.length) {
            cmd.styledHeader('# Assignment Rules');
            context.ux.table(result, {
                name: {},
                url: {},
            });
        }

        return result;
    });
})
