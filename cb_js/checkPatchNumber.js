(function(cmd, context) {
    context.ux.action.start('Checking Patch Number');
    return context.connection.query('SELECT InstanceName FROM Organization LIMIT 1').then(data => {
        const instanceName = data.records[0].InstanceName;
        const url = 'https://api.status.salesforce.com/v1/instances/' + instanceName + '/status';

        return context.axios.get(url).then(response => {
            const trustData = response.data;

            const result = {
                InstanceName: instanceName,
                ReleaseVersion: trustData.releaseVersion || 'N/A',
                ReleaseNumber: trustData.releaseNumber || 'N/A',
                Status: trustData.status || 'N/A',
                Location: trustData.location || 'N/A',
                Environment: trustData.environment || 'N/A',
            };

            const items = [];
            const columns = {
                name: {},
                value: {},
            };
            Object.keys(result).forEach(key => {
                items.push({ name: key, value: result[key] });
            });

            context.ux.table(items, columns);

            return result;
        });
    }).finally(() => context.ux.action.stop());
})
