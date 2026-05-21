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

        context.ux.action.start('Fetching Cartoon record');
        return context.mypim.query(
            `SELECT Id, Extension__c FROM Item__c WHERE Type__c = 'Cartoon' AND Id = '${escapedId}' LIMIT 1`
        ).then(itemResult => {
            const item = itemResult.records[0];
            if(!item) {
                cmd.error('No Cartoon Item__c found with Id ' + recordId);
                return;
            }
            if(!item.Extension__c) {
                cmd.error('Item__c ' + item.Id + ' has no Extension__c');
                return;
            }

            return context.mypim.query(
                `SELECT Id, Value__c FROM Config_Item__c WHERE Path__c = '/API/pCloud/PublicFolderPath' LIMIT 1`
            ).then(cfgResult => {
                const cfg = cfgResult.records[0];
                if(!cfg) {
                    cmd.error("Config_Item__c with Path__c='/API/pCloud/PublicFolderPath' not found");
                    return;
                }

                const cartoonUrl = cfg.Value__c + item.Extension__c;
                const scriptPath = path.join(os.homedir(), 'mypim-codebuilder', 'scripts', 'meta-movie.py');

                context.ux.action.stop();
                cmd.log('Probing: ' + cartoonUrl);
                const spawnResult = cp.spawnSync('python3', [ scriptPath, cartoonUrl, ], {
                    stdio: [ 'ignore', 'pipe', 'inherit', ],
                });
                if(spawnResult.status !== 0) {
                    cmd.error('meta-movie.py exited with status ' + spawnResult.status);
                    return;
                }

                let meta;
                try {
                    meta = JSON.parse(spawnResult.stdout.toString().trim());
                } catch(e) {
                    cmd.error('Failed to parse meta-movie.py output: ' + e.message);
                    return;
                }

                const duration = Math.round(Number(meta.duration_seconds));
                const resolution = meta.resolution;
                if(!Number.isFinite(duration) || duration <= 0) {
                    cmd.error('Invalid duration_seconds in meta-movie.py output: ' + meta.duration_seconds);
                    return;
                }
                if(!resolution) {
                    cmd.error('Missing resolution in meta-movie.py output');
                    return;
                }

                context.ux.action.start('Updating Item__c');
                return context.mypim.update('Item__c', {
                    Id: item.Id,
                    Price__c: duration,
                    Password__c: resolution,
                    Show_In_UI__c: true,
                }).then(() => {
                    cmd.logSuccess('Updated ' + item.Id + ': ' + duration + 's, ' + resolution);
                });
            });
        }).finally(() => context.ux.action.stop());
    });
})
