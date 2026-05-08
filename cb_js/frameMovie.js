(function(cmd, context) {
    const dir = context.argv[0];

    if(!dir) {
        cmd.error('Directory is required');
        return;
    }

    return Promise.all([
        context.require('fs'),
        context.require('path'),
        context.require('child_process'),
        context.require('os'),
    ]).then(([ fsMod, pathMod, cpMod, osMod, ]) => {
        const fs = fsMod.default || fsMod;
        const path = pathMod.default || pathMod;
        const cp = cpMod.default || cpMod;
        const os = osMod.default || osMod;

        // The python framing step idles the Salesforce keep-alive socket for minutes,
        // so post-spawn calls can land on a half-closed connection. Retry once on hangup.
        const isHangup = err => {
            if(!err) return false;
            if(err.code === 'ECONNRESET' || err.code === 'EPIPE') return true;
            const msg = ((err.message || '') + '').toLowerCase();
            return msg.includes('socket hang up') || msg.includes('econnreset');
        };
        const retryOnHangup = fn => Promise.resolve().then(fn).catch(err => {
            if(!isHangup(err)) throw err;
            cmd.log('Connection dropped (' + (err.code || err.message) + '), retrying...');
            return fn();
        });

        context.ux.action.start('Finding next Movie');
        return context.mypim.query(
            `SELECT Id, Extension__c FROM Item__c WHERE Type__c = 'Movie' AND End_Date__c = null ORDER BY CreatedDate ASC LIMIT 1`
        ).then(itemResult => {
            const item = itemResult.records[0];
            if(!item) {
                cmd.error('No unprocessed Movie Item__c found');
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

                const movieUrl = cfg.Value__c + item.Extension__c;
                const scriptPath = path.join(os.homedir(), 'mypim-codebuilder', 'scripts', 'frame-movie.py');

                context.ux.action.stop();
                cmd.log('Framing: ' + movieUrl);
                const spawnResult = cp.spawnSync('python3', [ scriptPath, movieUrl, dir, ], { stdio: 'inherit' });
                if(spawnResult.status !== 0) {
                    cmd.error('frame-movie.py exited with status ' + spawnResult.status);
                    return;
                }

                const metaPath = path.join(dir, 'meta.json');
                let meta = {};
                if(fs.existsSync(metaPath)) {
                    meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                }
                meta.recordId = item.Id;
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 4));

                context.ux.action.start('Marking record processed');
                return retryOnHangup(() => context.mypim.update('Item__c', {
                    Id: item.Id,
                    End_Date__c: new Date().toISOString(),
                })).then(() => retryOnHangup(() => context.mypim.query(
                    `SELECT COUNT() FROM Item__c WHERE Type__c = 'Movie' AND End_Date__c = null`
                ))).then(countResult => {
                    cmd.logSuccess('Framed movie ' + item.Id + ' into ' + dir + ' (' + countResult.totalSize + ' remaining)');
                });
            });
        }).finally(() => context.ux.action.stop());
    });
})
