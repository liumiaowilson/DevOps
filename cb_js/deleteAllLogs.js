(function(cmd, context) {
    return context.connection.query('SELECT Id FROM ApexLog').then(data => {
        const apexLogIds = data.records.map(r => r.Id);
        return context.connection.sobject('ApexLog').delete(apexLogIds, { allowRecursive: true }).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
