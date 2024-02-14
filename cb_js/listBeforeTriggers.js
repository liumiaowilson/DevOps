(function(cmd, context) {
    const objectApiName = context.argv[0];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    return context.connection.query(`SELECT Id, Name, NamespacePrefix, UsageBeforeInsert, UsageBeforeUpdate, UsageBeforeDelete FROM ApexTrigger WHERE TableEnumOrId = '${objectApiName}' AND Status = 'Active' AND (UsageBeforeInsert = true OR UsageBeforeUpdate = true OR UsageBeforeDelete = true) ORDER BY Name ASC`).then(data => {
        const triggers = data.records.map(r => {
            const name = r.NamespacePrefix ? r.NamespacePrefix + '__' + r.Name : r.Name;
            const usage = [];
            if(r.UsageBeforeInsert) {
                usage.push('insert');
            }
            if(r.UsageBeforeUpdate) {
                usage.push('update');
            }
            if(r.UsageBeforeDelete) {
                usage.push('delete');
            }

            const url = context.connection.instanceUrl + `/lightning/setup/ObjectManager/${objectApiName}/ApexTriggers/${r.Id}/view`;

            const trigger = {
                id: r.Id,
                name,
                usage: usage.join(','),
                url,
            };

            return trigger;
        });

        if(triggers.length) {
            cmd.styledHeader('# Before Triggers');
            context.ux.table(triggers, {
                name: {},
                usage: {},
                url: {},
            });
        }

        return triggers;
    });
})
