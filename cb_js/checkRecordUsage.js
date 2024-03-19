const findByFields = (usageMap, recordId, cmd, context) => {
    return Promise.all(
        Object.values(usageMap)
            .filter(usage => usage.fields.length && usage.queryable)
            .map(usage => {
                const fields = [ 'Id' ];
                if(usage.nameField) {
                    fields.push(usage.nameField);
                }
                fields.push(...usage.fields);

                const query = `SELECT ${fields.join(', ')} FROM ${usage.objectApiName} WHERE ${usage.fields.map(field => field + " = '" + recordId + "'").join(' OR ')}`;
                return context.connection.query(query).then(data => {
                    return data.records.map(record => {
                        const id = record.Id;
                        const type = usage.objectApiName;
                        const name = usage.nameField ? record[usage.nameField] : '';
                        const usageList = [];
                        for(const field of usage.fields) {
                            if(record[field] === recordId) {
                                usageList.push(field);
                            }
                        }

                        return {
                            id,
                            type,
                            source: 'reference',
                            name,
                            usage: usageList.join(','),
                        };
                    });
                }).catch(error => []);
            })
    ).then(dataList => dataList.flat());
};

const findByTextFields = (usageMap, recordId, cmd, context) => {
    if(recordId.length === 18) {
        recordId = recordId.substring(0, 15);
    }

    return Promise.all(
        Object.values(usageMap)
            .filter(usage => usage.textFields.length && usage.searchable)
            .map(usage => {
                const fields = [ 'Id' ];
                fields.push(...usage.textFields);
                if(usage.nameField && !fields.includes(usage.nameField)) {
                    fields.push(usage.nameField);
                }

                const query = `FIND {*${recordId}*} IN ALL FIELDS RETURNING ${usage.objectApiName}(${fields.join(', ')})`;
                return context.connection.search(query).then(data => {
                    return data.searchRecords.map(record => {
                        const id = record.Id;
                        const type = usage.objectApiName;
                        const name = usage.nameField ? record[usage.nameField] : '';
                        const usageList = [];
                        for(const field of usage.textFields) {
                            if(record[field] && record[field].includes(recordId)) {
                                usageList.push(field);
                            }
                        }

                        return {
                            id,
                            type,
                            source: 'textField',
                            name,
                            usage: usageList.join(','),
                        };
                    });
                }).catch(error => []);
            })
    ).then(dataList => dataList.flat());
};

const findByFilterableTextFields = (usageMap, recordId, cmd, context) => {
    if(recordId.length === 18) {
        recordId = recordId.substring(0, 15);
    }

    return Promise.all(
        Object.values(usageMap)
            .filter(usage => usage.filterableTextFields.length && !usage.searchable && usage.queryable)
            .map(usage => {
                const fields = [ 'Id' ];
                fields.push(...usage.filterableTextFields);
                if(usage.nameField && !fields.includes(usage.nameField)) {
                    fields.push(usage.nameField);
                }

                const query = `SELECT ${fields.join(', ')} FROM ${usage.objectApiName} WHERE ${usage.filterableTextFields.map(field => field + " LIKE '%" + recordId + "%'").join(' OR ')}`;
                return context.connection.query(query).then(data => {
                    return data.records.map(record => {
                        const id = record.Id;
                        const type = usage.objectApiName;
                        const name = usage.nameField ? record[usage.nameField] : '';
                        const usageList = [];
                        for(const field of usage.filterableTextFields) {
                            if(record[field] && record[field].includes(recordId)) {
                                usageList.push(field);
                            }
                        }

                        return {
                            id,
                            type,
                            source: 'fitlerableTextField',
                            name,
                            usage: usageList.join(','),
                        };
                    });
                }).catch(error => []);
            })
    ).then(dataList => dataList.flat());
};

(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    context.ux.action.start('Calculating');
    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    return Promise.all([
        context.fs.readFile(homeDir + '/objectUsage.json', 'utf8'),
        context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8'),
    ]).then(([ objectUsageJSON, keyPrefixJSON ]) => {
        const keyPrefixMap = JSON.parse(keyPrefixJSON);
        const objectUsage = JSON.parse(objectUsageJSON);
        const prefix = recordId.substring(0, 3);
        const objectApiName = keyPrefixMap[prefix];
        if(objectUsage.target !== objectApiName) {
            cmd.error('Invalid object usage generated for this record id: ' + recordId);
            return;
        }

        const usageMap = objectUsage.usage;
        return Promise.all([
            findByFields(usageMap, recordId, cmd, context),
            findByTextFields(usageMap, recordId, cmd, context),
            findByFilterableTextFields(usageMap, recordId, cmd, context),
        ]).then(([ fieldsResult, textFieldsResult, filterableTextFieldsResult, ]) => {
            const result = [
                ...fieldsResult,
                ...textFieldsResult,
                ...filterableTextFieldsResult,
            ].filter(item => !!item.usage.length).map(item => {
                return {
                    ...item,
                    url: '[m://' + item.id + ']',
                };
            });

            return context.fs.writeFile(homeDir + '/recordUsage.json', JSON.stringify(result, null, 4)).then(() => {
                context.ux.table(result, {
                    url: {},
                    type: {},
                    source: {},
                    name: {},
                    usage: {},
                });

                return result;
            });
        });
    }).finally(() => context.ux.action.stop());
})
