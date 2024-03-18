(function(cmd, context) {
    const objectApiNames = context.argv;
    if(!objectApiNames.length) {
        cmd.error('Object Api Names are required');
        return;
    }

    context.ux.action.start('Calculating');
    return Promise.all(objectApiNames.map(objectApiName => context.connection.describeSObject(objectApiName))).then(describeList => {
        const allObjectApiNames = [];
        describeList.forEach(describe => {
            describe.fields.forEach(field => {
                if(field.referenceTo && field.referenceTo.length) {
                    field.referenceTo.forEach(refTo => {
                        if(!allObjectApiNames.includes(refTo)) {
                            allObjectApiNames.push(refTo);
                        }
                    });
                }
            });
        });

        for(const objectApiName of objectApiNames) {
            if(!allObjectApiNames.includes(objectApiName)) {
                allObjectApiNames.push(objectApiName);
            }
        }

        return context.connection.query(`SELECT Id, QualifiedApiName, InternalSharingModel, ExternalSharingModel FROM EntityDefinition WHERE QualifiedApiName IN (${allObjectApiNames.map(n => "'" + n + "'").join(',')})`).then(data => {
            const dataMap = data.records.reduce((result, item) => {
                result[item.QualifiedApiName] = {
                    name: item.QualifiedApiName,
                    internal: item.InternalSharingModel,
                    external: item.ExternalSharingModel,
                };

                return result;
            }, {});

            const selected = [];
            const referenced = [];

            for(const objectApiName of allObjectApiNames) {
                const record = dataMap[objectApiName];
                if(objectApiNames.includes(objectApiName)) {
                    selected.push(record);
                }
                else {
                    referenced.push(record);
                }
            }

            cmd.styledHeader('Selected Objects');
            context.ux.table(selected, {
                name: {},
                internal: {},
                external: {},
            });

            cmd.styledHeader('Referenced Objects');
            context.ux.table(referenced, {
                name: {},
                internal: {},
                external: {},
            });
        });
    }).finally(() => context.ux.action.stop());
})
