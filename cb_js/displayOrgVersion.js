(function(cmd, context) {
    return Promise.all([
        context.connection.request('/services/data'),
        context.connection.query('SELECT Id, IsSandbox, NamespacePrefix, OrganizationType, TrialExpirationDate FROM Organization LIMIT 1'),
    ]).then(([ data1, data2 ]) => {
        const record = data2.records[0];
        let orgType = 'Production';
        if(record.IsSandbox) {
            if(record.TrialExpirationDate) {
                orgType = 'Scratch';
            }
            else {
                orgType = 'Sandbox';
            }
        }

        const result = {
            ReleaseName: data1[data1.length - 1].label,
            ApiVersion: data1[data1.length - 1].version,
            OrgEdition: record.OrganizationType,
            Namespace: record.NamespacePrefix,
            OrgType: orgType,
            ExpirationDate: record.TrialExpirationDate,
        };

        const items = [];
        const columns = {
            name: {},
            value: {},
        };
        Object.keys(result).forEach(key => {
            const value = result[key];
            items.push({ name: key, value, });
        });

        context.ux.table(items, columns);

        return result;
    });
})
