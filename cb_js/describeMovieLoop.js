(function(cmd, context) {
    return Promise.all([
        context.require('path'),
        context.require('child_process'),
        context.require('os'),
    ]).then(([ pathMod, cpMod, osMod, ]) => {
        const path = pathMod.default || pathMod;
        const cp = cpMod.default || cpMod;
        const os = osMod.default || osMod;

        const scriptPath = path.join(os.homedir(), 'mypim-codebuilder', 'scripts', 'describe-movie.py');

        let described = 0;
        let skipped = 0;

        function loop() {
            context.ux.action.start('Querying next unprocessed Movie Item__c');
            return context.mypim.query(
                `SELECT Id, Name, Text__c FROM Item__c WHERE Type__c = 'Movie' AND Show_In_UI__c = false ORDER BY Id LIMIT 1`
            ).then(result => {
                context.ux.action.stop();

                const item = result.records[0];
                if(!item) {
                    return; // nothing left to process
                }

                const num = described + skipped + 1;
                const textLen = item.Text__c ? item.Text__c.length : 0;
                cmd.log(
                    '===== [' + num + '] ' + item.Id + ' — ' + (item.Name || '(no name)') +
                    ' — Text__c ' + textLen + ' chars (' + new Date().toISOString() + ') ====='
                );

                // No frame descriptions to summarize. Mark processed so the loop advances.
                if(!item.Text__c || !item.Text__c.trim()) {
                    cmd.warn('Text__c is empty; marking Show_In_UI__c = true and skipping.');
                    return context.mypim.update('Item__c', {
                        Id: item.Id,
                        Show_In_UI__c: true,
                    }).then(() => {
                        skipped++;
                        return loop();
                    });
                }

                cmd.log('Describing ' + item.Id + ' via ' + scriptPath + ' ...');
                const spawnResult = cp.spawnSync('python3', [ scriptPath, ], {
                    input: item.Text__c,
                    encoding: 'utf8',
                    stdio: [ 'pipe', 'pipe', 'inherit', ],
                });
                if(spawnResult.status !== 0) {
                    cmd.error('describe-movie.py exited with status ' + spawnResult.status + ' for ' + item.Id + '; aborting loop.');
                    return;
                }

                const description = (spawnResult.stdout || '').trim();
                if(!description) {
                    cmd.error('describe-movie.py produced empty output for ' + item.Id + '; aborting loop.');
                    return;
                }

                context.ux.action.start('Saving description to ' + item.Id);
                return context.mypim.update('Item__c', {
                    Id: item.Id,
                    Description__c: description,
                    Show_In_UI__c: true,
                }).then(() => {
                    context.ux.action.stop();
                    described++;
                    cmd.logSuccess('Saved Description__c (' + description.length + ' chars) and set Show_In_UI__c = true on ' + item.Id);
                    return loop();
                });
            }).finally(() => context.ux.action.stop());
        }

        return loop().then(() => {
            cmd.log('Done. Described: ' + described + ', Skipped (empty Text__c): ' + skipped);
        });
    });
})
