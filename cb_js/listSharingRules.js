(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Sharing Rules');
    const types = [
        'SharingCriteriaRule',
        'SharingGuestRule',
        'SharingOwnerRule',
        'SharingTerritoryRule',
    ];

    return context.connection.query(`SELECT Id, NamespacePrefix FROM EntityDefinition WHERE QualifiedApiName = '${objectApiName}'`).then(data => {
        if(!data.records.length) {
            cmd.error('Invalid object api name: ' + objectApiName);
            return;
        }

        const ns = data.records[0].NamespacePrefix;
        let localName = objectApiName;
        if(ns && objectApiName.startsWith(ns)) {
            localName = objectApiName.substring(ns.length + 2);
        }

        return Promise.all(types.map(t => context.connection.metadata.list([ { type: t } ]).catch(e => []))).then(dataList => {
            const result = dataList.flat().map(record => {
                const [ targetObjectApiName, name ] = record.fullName.split('.');
                if(targetObjectApiName !== localName) {
                    return;
                }

                return {
                    id: record.id,
                    name,
                    type: record.type.substring(7, record.type.length - 4),
                    url: '[m://sharingRule/' + record.id + ']',
                };
            }).filter(Boolean);

            if(result.length) {
                cmd.styledHeader('# Sharing Rules');
                context.ux.table(result, {
                    name: {},
                    type: {},
                    url: {},
                });
            }

            return result;
        });
    }).finally(() => context.ux.action.stop());
})
