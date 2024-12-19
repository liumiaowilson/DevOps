(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    const computeRSSFile = homeDir + '/modelApiAgent/remoteSiteSettings/Compute.remoteSite-meta.xml';

    context.ux.action.start('Setting up Model API Agent');
    return context.mypim.query(`SELECT Id, Value__c FROM Config_Item__c WHERE Path__c = '/Compute/BaseUrl'`).then(result => {
        const record = result.records[0];
        if(!record) {
            cmd.error('Compute Base URL is not set');
            return;
        }

        const baseUrl = record.Value__c;
        return context.fs.readFile(computeRSSFile, 'utf8').then(content => {
            content = content.replace('COMPUTE_BASE_URL', baseUrl);
            return context.fs.writeFile(computeRSSFile, content);
        });
    }).finally(() => context.ux.action.stop());
})
