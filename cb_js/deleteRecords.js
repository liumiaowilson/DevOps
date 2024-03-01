(function(cmd, context) {
    const query = context.argv.join(' ');

    if(!query) {
        cmd.error('Query is required');
        return;
    }

    return context.connection.query(query).then(data => {
        if(!data.records.length) {
            cmd.logSuccess('No records to delete');
            return;
        }

        const objectApiName = data.records[0].attributes.type;
        const recordIds = data.records.map(r => r.Id);
        return context.connection.sobject(objectApiName).delete(recordIds, { allowRecursive: true }).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
