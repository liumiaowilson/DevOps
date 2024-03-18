(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId || !recordId.startsWith('015')) {
        cmd.error('Invalid document id');
        return;
    }

    return context.connection.query(`SELECT Id, Folder.DeveloperName, Folder.NamespacePrefix, DeveloperName, NamespacePrefix, Type FROM Document WHERE Id = '${recordId}'`).then(data => {
        if(!data.records.length) {
            cmd.error('Document not found');
            return;
        }

        const record = data.records[0];
        let path = '';
        if(record.Folder) {
            if(record.Folder.NamespacePrefix) {
                path += record.Folder.NamespacePrefix + '__';
            }

            path += record.Folder.DeveloperName + '/';
        }

        if(record.NamespacePrefix) {
            path += record.NamespacePrefix + '__';
        }

        path += record.DeveloperName + '.' + record.Type;

        cmd.styledHeader('Document Path');
        cmd.log(path);
        return path;
    });
})
