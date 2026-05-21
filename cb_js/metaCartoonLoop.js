(function(cmd, context) {
    const homeDir = context.env.getString('CODE_BUILDER_HOME');

    context.ux.action.start('Querying unprocessed Cartoon Item__c records');
    return context.mypim.query(
        `SELECT Id FROM Item__c WHERE Type__c = 'Cartoon' AND Show_In_UI__c = false`
    ).then(result => {
        const ids = result.records.map(r => r.Id).join('\n');
        return context.fs.writeFile(homeDir + '/.metaCartoonLoopIds', ids).then(() => {
            cmd.log('Found ' + result.records.length + ' record(s)');
        });
    }).finally(() => context.ux.action.stop());
})
