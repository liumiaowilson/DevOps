(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    return context.fs.readFile(path, 'utf8').then(content => {
        const pattern1 = '"optionsKey": "Topic.Name"';
        const idx1 = content.indexOf(pattern1);
        content = content.substring(0, idx1) + '"optionsKey": "practifi__Topics__c"' + content.substring(idx1 + pattern1.length);
        const pattern2 = '"componentType": "dataSource"';
        const idx2 = content.indexOf(pattern2, idx1);
        content = content.substring(0, idx2) + '"componentType": "aggregateDataSource"' + content.substring(idx2 + pattern2.length);
        const pattern3 = '"fieldName": "Topic.Name"';
        const idx3 = content.indexOf(pattern3, idx2);
        content = content.substring(0, idx3) + '"fieldName": "Topic.Name",\n"fieldAlias": "practifi__Topics__c"' + content.substring(idx3 + pattern3.length);
        return context.fs.writeFile(path, content).then(() => {
            cmd.logSuccess('Done');
        });
    });
})
