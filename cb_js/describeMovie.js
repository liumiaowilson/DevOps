(function(cmd, context) {
    const recordId = context.argv[0];

    if(!recordId) {
        cmd.error('recordId is required');
        return;
    }

    const escapedId = recordId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return Promise.all([
        context.require('path'),
        context.require('child_process'),
        context.require('os'),
    ]).then(([ pathMod, cpMod, osMod, ]) => {
        const path = pathMod.default || pathMod;
        const cp = cpMod.default || cpMod;
        const os = osMod.default || osMod;

        context.ux.action.start('Fetching Movie record');
        return context.mypim.query(
            `SELECT Id, Text__c FROM Item__c WHERE Type__c = 'Movie' AND Id = '${escapedId}' LIMIT 1`
        ).then(itemResult => {
            const item = itemResult.records[0];
            if(!item) {
                cmd.error('No Movie Item__c found with Id ' + recordId);
                return;
            }
            if(!item.Text__c || !item.Text__c.trim()) {
                cmd.error('Item__c Text__c is empty');
                return;
            }

            const scriptPath = path.join(os.homedir(), 'mypim-codebuilder', 'scripts', 'describe-movie.py');

            context.ux.action.stop();
            cmd.log('Summarizing ' + item.Id);
            const spawnResult = cp.spawnSync('python3', [ scriptPath, ], {
                input: item.Text__c,
                stdio: [ 'pipe', 'inherit', 'inherit', ],
            });
            if(spawnResult.status !== 0) {
                cmd.error('describe-movie.py exited with status ' + spawnResult.status);
                return;
            }
        }).finally(() => context.ux.action.stop());
    });
})
