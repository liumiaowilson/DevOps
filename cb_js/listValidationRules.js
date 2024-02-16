(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Validation Rules');
    return context.connection.query(`SELECT DurableId, NamespacePrefix FROM EntityDefinition WHERE QualifiedApiName = '${objectApiName}'`).then(entityData => {
        const entity = entityData.records[0];
        if(!entity) {
            cmd.error('Invalid object api name: ' + objectApiName);
            return [];
        }

        return context.connection.tooling.query(`SELECT Id FROM ValidationRule WHERE EntityDefinitionId = '${entity.DurableId}' AND Active = true`).then(vrData => {
            return Promise.all(vrData.records.map(record => context.connection.tooling.query(`SELECT Id, FullName FROM ValidationRule WHERE Id = '${record.Id}'`))).then(dataList => {
                const result = dataList.map(data => {
                    const vr = data.records[0];
                    if(!vr) return;

                    const [ , name ] = vr.FullName.split('.');

                    return {
                        id: vr.Id,
                        name,
                        url: '[m://validationRule/' + entity.DurableId + '/' + vr.Id + ']',
                    };
                }).filter(Boolean);

                if(result.length) {
                    cmd.styledHeader('# Validation Rules');
                    context.ux.table(result, {
                        name: {},
                        url: {},
                    });
                }

                return result;
            });
        });
    }).finally(() => context.ux.action.stop());
})
