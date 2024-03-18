(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating');
    return context.connection.describeGlobal().then(data => {
        return Promise.all(data.sobjects.map(sobject => context.connection.describeSObject(sobject.name))).then(describeList => {
            const referencing = [];
            describeList.forEach(describe => {
                describe.fields.forEach(field => {
                    if(field.referenceTo && field.referenceTo.length) {
                        field.referenceTo.forEach(refTo => {
                            if(refTo === objectApiName) {
                                referencing.push({
                                    objectApiName: describe.name,
                                    fieldName: field.name,
                                });
                            }
                        });
                    }
                });
            });

            cmd.styledHeader('Referencing');
            context.ux.table(referencing, {
                objectApiName: {},
                fieldName: {},
            });

            return referencing;
        });
    }).finally(() => context.ux.action.stop());
})
