(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    return context.connection.query(`SELECT DurableId FROM EntityDefinition WHERE QualifiedApiName = '${objectApiName}'`).then(data => {
        const record = data.records[0];
        if(!record) {
            cmd.error('Invalid object api name: ' + objectApiName);
            return;
        }

        const durableId = record.DurableId;
        return context.connection.query(`SELECT DurableId, ApiName, NamespacePrefix, RecordTriggerType FROM FlowDefinitionView WHERE IsActive = true AND TriggerObjectOrEventId = '${durableId}' AND TriggerType = 'RecordAfterSave' ORDER BY TriggerOrder ASC`).then(data => {
            const flows = data.records;

            if(!flows.length) {
                return [];
            }

            const result = flows.map(flow => {
                return {
                    id: flow.DurableId,
                    name: flow.NamespacePrefix ? flow.NamespacePrefix + '__' + flow.ApiName : flow.ApiName,
                    usage: flow.RecordTriggerType,
                    url: '[m://flow/' + flow.DurableId + ']',
                };
            });

            cmd.styledHeader('# After Flows');
            context.ux.table(result, {
                name: {},
                usage: {},
                url: {},
            });

            return result;
        });
    });
})
