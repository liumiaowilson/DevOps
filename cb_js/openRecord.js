(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    return Promise.all([
        context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8'),
        context.fs.readFile(homeDir + '/apps.json', 'utf8'),
        context.fs.readFile(homeDir + '/DevOps/json/apps.json', 'utf8'),
    ]).then(([ keyPrefixJSON, appsJSON, userAppsJSON ]) => {
        const keyPrefixMap = JSON.parse(keyPrefixJSON);
        const appsMap = JSON.parse(appsJSON);
        const userAppsMap = JSON.parse(userAppsJSON);

        const keyPrefix = recordId.substring(0, 3);
        if(keyPrefixMap[keyPrefix]) {
            const objectApiName = keyPrefixMap[keyPrefix];
            const appName = userAppsMap[objectApiName];
            if(appName) {
                const appId = appsMap[appName];
                if(appId) {
                    const url = context.connection.instanceUrl + '/lightning/app/' + appId + '/r/' + objectApiName + '/' + recordId + '/view';
                    context.open(url);
                    return url;
                }
            }
        }

        const url = context.connection.instanceUrl + '/' + recordId;
        context.open(url);
        return url;
    });
})
