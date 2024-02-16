(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    context.ux.action.start('Calculating After Triggers');
    return context.connection.query(`SELECT Id, Name, NamespacePrefix, UsageAfterInsert, UsageAfterUpdate, UsageAfterDelete, UsageAfterUndelete FROM ApexTrigger WHERE TableEnumOrId = '${objectApiName}' AND Status = 'Active' AND (UsageAfterInsert = true OR UsageAfterUpdate = true OR UsageAfterDelete = true OR UsageAfterUndelete = true) ORDER BY Name ASC`).then(data => {
        const triggers = data.records.map(r => {
            const name = r.NamespacePrefix ? r.NamespacePrefix + '__' + r.Name : r.Name;
            const usage = [];
            if(r.UsageAfterInsert) {
                usage.push('insert');
            }
            if(r.UsageAfterUpdate) {
                usage.push('update');
            }
            if(r.UsageAfterDelete) {
                usage.push('delete');
            }
            if(r.UsageAfterUndelete) {
                usage.push('undelete');
            }

            const url = `[m://trigger/${objectApiName}/${r.Id}]`;

            const trigger = {
                id: r.Id,
                name,
                usage: usage.join(','),
                url,
            };

            return trigger;
        });

        if(triggers.length) {
            cmd.styledHeader('# After Triggers');
            context.ux.table(triggers, {
                name: {},
                usage: {},
                url: {},
            });
        }

        return triggers;
    }).finally(() => context.ux.action.stop());
})
