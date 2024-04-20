function collectObjectApiNames(data, objectApiNames) {
    if(data && typeof data === 'object' && data.constructor === Object) {
        if(data.attributes?.type && !objectApiNames.includes(data.attributes?.type)) {
            objectApiNames.push(data.attributes.type);
        }

        Object.values(data).forEach(value => collectObjectApiNames(value, objectApiNames));
    }
    else if(Array.isArray(data)) {
        data.forEach(item => collectObjectApiNames(item, objectApiNames));
    }
    else {
        return;
    }
}

function collectRecordsToUpdate(data, objMap, recordsToCreate, recordsToUpdate, recordsToDelete) {
    if(data && typeof data === 'object' && data.constructor === Object) {
        const objectApiName = data.attributes?.type;
        if(objectApiName) {
            const objInfo = objMap[objectApiName];
            const record = {};
            record.Id = data.Id;

            Object.keys(data).forEach(key => {
                if(record.Id) {
                    if(!objInfo.updateableFields.includes(key)) {
                        return;
                    }
                }
                else {
                    if(!objInfo.createableFields.includes(key)) {
                        return;
                    }
                }

                let value = data[key];
                if(value && typeof value === 'object' && value.constructor === Object) {
                    value = JSON.stringify(value);
                }
                else if(Array.isArray(value)) {
                    value = JSON.stringify(value);
                }

                record[key] = value;
            });

            if(data.IsDeleted) {
                const records = recordsToDelete[objectApiName] || [];
                records.push(record);
                recordsToDelete[objectApiName] = records;
            }
            else if(data.Id) {
                const records = recordsToUpdate[objectApiName] || [];
                records.push(record);
                recordsToUpdate[objectApiName] = records;
            }
            else {
                const records = recordsToCreate[objectApiName] || [];
                records.push(record);
                recordsToCreate[objectApiName] = records;
            }
        }

        Object.values(data).forEach(value => collectRecordsToUpdate(value, objMap, recordsToCreate, recordsToUpdate, recordsToDelete));
    }
    else if(Array.isArray(data)) {
        data.forEach(item => collectRecordsToUpdate(item, objMap, recordsToCreate, recordsToUpdate, recordsToDelete));
    }
    else {
        return;
    }
}

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    context.ux.action.start('Deploying record');

    return context.fs.readFile(path, 'utf8').then(content => {
        const data = JSON.parse(content);

        const objectApiNames = [];
        collectObjectApiNames(data, objectApiNames);

        return Promise.all(objectApiNames.map(objectApiName => {
            return context.connection.describe(objectApiName).then(objDescribe => {
                const updateableFields = objDescribe.fields.filter(field => field.updateable).map(field => field.name);
                const createableFields = objDescribe.fields.filter(field => field.createable).map(field => field.name);

                return {
                    objectApiName,
                    updateableFields,
                    createableFields,
                };
            });
        })).then(dataList => {
            const objMap = dataList.reduce((res, cur) => {
                return {
                    ...res,
                    [cur.objectApiName]: cur,
                };
            }, {});

            const recordsToCreate = {};
            const recordsToUpdate = {};
            const recordsToDelete = {};
            collectRecordsToUpdate(data, objMap, recordsToCreate, recordsToUpdate, recordsToDelete);

            return Promise.all([
                Promise.all(Object.keys(recordsToCreate).map(objectApiName => {
                    return context.connection.sobject(objectApiName).insert(recordsToCreate[objectApiName]);
                })),
                Promise.all(Object.keys(recordsToUpdate).map(objectApiName => {
                    return context.connection.sobject(objectApiName).update(recordsToUpdate[objectApiName]);
                })),
                Promise.all(Object.keys(recordsToDelete).map(objectApiName => {
                    return context.connection.sobject(objectApiName).delete(recordsToDelete[objectApiName]);
                })),
            ]).then(() => {
                cmd.logSuccess('Records deployed successfully');
            });
        });
    }).finally(() => context.ux.action.stop());
})
