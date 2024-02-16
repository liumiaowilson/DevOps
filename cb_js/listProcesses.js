(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating Processes');
    return context.connection.tooling.query(`SELECT Id FROM Flow WHERE ProcessType = 'Workflow'`).then(flows => {
        return Promise.all(flows.records.map(flow => context.connection.tooling.query(`SELECT Id, FullName, Status, Metadata FROM Flow WHERE Id = '${flow.Id}'`))).then(dataList => {
            const processes = dataList.map(data => {
                const record = data.records[0];
                if(!record) return;

                const objectType = record.Metadata.processMetadataValues && record.Metadata.processMetadataValues.find(v => v.name === 'ObjectType');
                if(!objectType || objectType.value.stringValue !== objectApiName) {
                    return;
                }

                return {
                    id: record.Id,
                    name: record.FullName,
                    status: record.Status,
                };
            }).filter(Boolean);

            if(processes.length) {
                cmd.styledHeader('# Processes');
                context.ux.table(processes, {
                    name: {},
                    status: {},
                });
            }

            return processes;
        });
    }).finally(() => context.ux.action.stop());
})
