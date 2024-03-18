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
            const usageMap = {};
            describeList.forEach(describe => {
                let nameField = null;
                describe.fields.forEach(field => {
                    if(field.nameField) {
                        nameField = field.name;
                    }
                });

                describe.fields.forEach(field => {
                    if(field.referenceTo && field.referenceTo.length) {
                        field.referenceTo.forEach(refTo => {
                            if(refTo === objectApiName) {
                                referencing.push({
                                    objectApiName: describe.name,
                                    fieldName: field.name,
                                });

                                const usage = usageMap[describe.name] || ({ objectApiName: describe.name, nameField: nameField, fields: [] });
                                usage.fields.push(field.name);
                                usageMap[describe.name] = usage;
                            }
                        });
                    }
                });
            });

            const homeDir = context.env.getString('CODE_BUILDER_HOME');
            return context.fs.writeFile(homeDir + '/objectUsage.json', JSON.stringify({
                target: objectApiName,
                usage: usageMap,
            }, null, 4)).then(() => {
                cmd.styledHeader('Referencing');
                context.ux.table(referencing, {
                    objectApiName: {},
                    fieldName: {},
                });

                return referencing;
            });
        });
    }).finally(() => context.ux.action.stop());
})
