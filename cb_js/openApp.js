(function(cmd, context) {
    const appName = context.argv[0];
    if(!appName) {
        cmd.error('App Name is required');
        return;
    }

    return context.fs.readFile('/home/codebuilder/apps.json', 'utf8').then(appsJSON => {
        const appsMap = JSON.parse(appsJSON);
        const appId = appsMap[appName];
        if(!appId) {
            cmd.error('Invalid app name: ' + appName);
            return;
        }

        const url = context.connection.instanceUrl + '/lightning/app/' + appId;
        context.open(url);
        return url;
    });
})
