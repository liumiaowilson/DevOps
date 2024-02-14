(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Link Path is required');
        return;
    }

    const items = path.split('/');
    if(items.length === 1) {
        const recordId = items[0];
        const url = context.connection.instanceUrl + '/' + recordId;
        context.open(url);
        return url;
    }
    else {
        cmd.error('Not supported yet');
    }
})
