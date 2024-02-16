(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Workflow Rules');
    return context.connection.tooling.query(`SELECT Id FROM WorkflowRule WHERE TableEnumOrId = '${objectApiName}'`).then(data => {
        return Promise.all(data.records.map(wf => context.connection.tooling.query(`SELECT Id, Metadata, FullName FROM WorkflowRule WHERE Id = '${wf.Id}'`))).then(dataList => {
            const result = dataList.map(data => {
                const record = data.records[0];
                if(!record) return;
                if(!record.Metadata.active) return;

                return {
                    id: record.Id,
                    name: record.FullName,
                    url: '[m://workflowRule/' + record.Id + ']',
                };
            }).filter(Boolean);

            if(result.length) {
                cmd.styledHeader('# Workflow Rules');
                context.ux.table(result, {
                    name: {},
                    url: {},
                });
            }

            return result;
        });
    }).finally(() => context.ux.action.stop());
})
