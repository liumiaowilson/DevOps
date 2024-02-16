(function(cmd, context) {
    const objectApiName = argv[0];
    if(!objectApiName) {
        cmd.error('Object Api name is required');
        return;
    }

    context.ux.action.start('Calculating Rollup Summary Fields');
    return context.connection.query(`SELECT Id, DurableId FROM EntityDefinition WHERE QualifiedApiName = '${objectApiName}'`).then(data => {
        if(!data.records.length) {
            cmd.error('Invalid object api name: ' + objectApiName);
            return;
        }

        const durableId = data.records[0].DurableId;

        return context.connection.tooling.query(`SELECT Id FROM CustomField WHERE TableEnumOrId = '${durableId}'`).then(data => {
            return Promise.all(data.records.map(record => context.connection.tooling.query(`SELECT Id, FullName, Metadata FROM CustomField WHERE Id = '${record.Id}'`).then(data => data.records[0])));
        }).then(data => {
            const masterDetailFields = data.filter(record => {
                return record.Metadata.type === 'MasterDetail';
            });

            if(masterDetailFields.length) {
                const parentSObjectNames = masterDetailFields.map(field => field.Metadata.referenceTo);
                return context.connection.query(`SELECT Id, DurableId, QualifiedApiName FROM EntityDefinition WHERE QualifiedApiName IN (${parentSObjectNames.map(n => "'" + n + "'").join(',')})`).then(data => {
                    const parentSObjectNamesMap = {};
                    data.records.forEach(record => {
                        parentSObjectNamesMap[record.QualifiedApiName] = record.DurableId;
                    });

                    return context.connection.tooling.query(`SELECT Id FROM CustomField WHERE TableEnumOrId IN (${Object.values(parentSObjectNamesMap).map(n => "'" + n + "'").join(',')})`).then(data => {
                        return Promise.all(data.records.map(record => context.connection.tooling.query(`SELECT Id, FullName, Metadata, TableEnumOrId FROM CustomField WHERE Id = '${record.Id}'`).then(data => data.records[0])));
                    }).then(data => {
                        const summaryFields = data.filter(record => record.Metadata.type === 'Summary').map(record => {
                            const [ targetObjectApiName ] = record.Metadata.summaryForeignKey.split('.');
                            if(targetObjectApiName !== objectApiName) {
                                return;
                            }

                            return {
                                id: record.Id,
                                name: record.FullName,
                                formula: `${record.Metadata.summaryOperation}: ${record.Metadata.summarizedField}`,
                                url: '[m://field/' + record.TableEnumOrId + '.' + record.Id + ']',
                            };
                        }).filter(Boolean);

                        if(summaryFields.length) {
                            cmd.styledHeader('# Rollup Summary Fields');
                            context.ux.table(summaryFields, {
                                name: {},
                                formula: {},
                                url: {},
                            });
                        }

                        return summaryFields;
                    });
                });
            }
            else {
                return [];
            }
        });
    }).finally(() => context.ux.action.stop());
})
