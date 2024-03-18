const isValidObject = objectApiName => !objectApiName.endsWith('Share') && !objectApiName.endsWith('ChangeEvent') && !objectApiName.endsWith('Feed');

(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating');
    return context.connection.describeGlobal().then(data => {
        return Promise.all(data.sobjects.filter(sobject => isValidObject(sobject.name)).map(sobject => context.connection.describeSObject(sobject.name))).then(describeList => {
            const usageMap = {};
            describeList.forEach(describe => {
                let nameField = null;
                describe.fields.forEach(field => {
                    if(field.nameField) {
                        nameField = field.name;
                    }
                });

                const defaultUsage = {
                    objectApiName: describe.name,
                    nameField: nameField,
                    queryable: describe.queryable,
                    searchable: describe.searchable,
                    fields: [],
                    textFields: [],
                    filterableTextFields: [],
                };

                describe.fields.forEach(field => {
                    if(field.name === 'Name') {
                        return;
                    }

                    if(field.referenceTo && field.referenceTo.length) {
                        field.referenceTo.forEach(refTo => {
                            if(refTo === objectApiName) {
                                const usage = usageMap[describe.name] || defaultUsage;
                                usage.fields.push(field.name);
                                usageMap[describe.name] = usage;
                            }
                        });
                    }
                    else if((field.type === 'string' || field.type === 'textarea') && field.length >= 18) {
                        const usage = usageMap[describe.name] || defaultUsage;
                        usage.textFields.push(field.name);
                        if(field.filterable) {
                            usage.filterableTextFields.push(field.name);
                        }
                        usageMap[describe.name] = usage;
                    }
                });
            });

            const homeDir = context.env.getString('CODE_BUILDER_HOME');
            const result = {
                target: objectApiName,
                usage: usageMap,
            };
            return context.fs.writeFile(homeDir + '/objectUsage.json', JSON.stringify(result, null, 4)).then(() => {
                const referencing = [];
                Object.keys(usageMap).forEach(key => {
                    const usage = usageMap[key];

                    if(usage.fields.length) {
                        referencing.push({
                            objectApiName: usage.objectApiName,
                            fieldNames: usage.fields.join(','),
                        });
                    }
                });

                cmd.styledHeader('Referencing');
                context.ux.table(referencing, {
                    objectApiName: {},
                    fieldNames: {},
                });

                cmd.log('For more details, please see ~/objectUsage.json');

                return result;
            });
        });
    }).finally(() => context.ux.action.stop());
})
