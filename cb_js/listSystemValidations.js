(function(cmd, context) {
    const ignoredFieldNames = [ 'CreatedDate', 'LastModifiedDate', 'SystemModstamp' ];

    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    return context.connection.describe(objectApiName).then(describe => {
        const fieldNames = [];
        const fields = [];
        for(const fieldDesc of describe.fields) {
            if(ignoredFieldNames.includes(fieldDesc.name)) {
                continue;
            }

            const field = {
                name: fieldDesc.name,
                validations: [],
            };

            if(fieldDesc.calculated) {
                field.validations.push('Formula');
            }

            if(fieldDesc.length && (![ 'multipicklist', 'picklist' ].includes(fieldDesc.type))) {
                field.validations.push('Max:' + fieldDesc.length);
            }

            if(!fieldDesc.nillable && (fieldDesc.type !== 'boolean')) {
                field.validations.push('Required');
            }

            if(fieldDesc.restrictedPicklist) {
                field.validations.push('Restricted');
            }

            if(fieldDesc.unique) {
                field.validations.push('Unique');
            }

            if(field.validations.length && (![ 'reference', 'id' ].includes(fieldDesc.type))) {
                fields.push(field);
                fieldNames.push(field.name);
            }
        }

        let fieldIdsPromise = null;
        if(fieldNames.length) {
            fieldIdsPromise = context.connection.query(`SELECT DurableId, QualifiedApiName FROM FieldDefinition WHERE EntityDefinitionId = '${objectApiName}' AND QualifiedApiName IN (${fieldNames.map(n => "'" + n + "'").join(',')})`).then(data => {
                return data.records.reduce((res, cur) => {
                    res[cur.QualifiedApiName] = cur.DurableId;
                    return res;
                }, {});
            });
        }
        else {
            fieldIdsPromise = Promise.resolve({});
        }

        return fieldIdsPromise.then(fieldIds => {
            for(const field of fields) {
                field.id = fieldIds[field.name];
            }

            cmd.styledHeader('# System Validations');
            context.ux.table(fields, {
                name: {},
                validations: {
                    get: row => {
                        return row.validations.join(',');
                    },
                },
                url: {
                    get: row => {
                        return '[m://field/' + row.id + ']';
                    },
                },
            });

            return fields;
        });
    });
})
