(function(cmd, context) {
    const userId = context.argv[0];
    if(!userId) {
        cmd.error('User Id is required');
        return;
    }

    const objectApiName = context.argv[1];
    if(!objectApiName) {
        cmd.error('Object Api Name is required');
        return;
    }

    return Promise.all([
        context.connection.sobject('ObjectPermissions').describe(),
    ]).then(([ objectPermissionsDescribe ]) => {
        const permissionNames = objectPermissionsDescribe.fields
            .filter(f => f.name.startsWith('Permission'))
            .map(f => f.name)
            .sort((a, b) => a.localeCompare(b));

        return Promise.all([
            context.connection.query(`SELECT Id, Name, NamespacePrefix, Profile.Name FROM PermissionSet`),
            context.connection.query(`SELECT Id FROM MutingPermissionSet`),
            context.connection.query(`SELECT Id, DeveloperName, NamespacePrefix FROM PermissionSetGroup`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetGroupComponent`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetAssignment WHERE IsActive = true AND AssigneeId = '${userId}'`),
            context.connection.query(`SELECT ParentId, ${permissionNames.join(', ')} FROM ObjectPermissions WHERE SobjectType = '${objectApiName}'`),
        ]).then(([ psData, mpsData, psgData, psgcData, psaData, opData ]) => {
            const result = [];

            const psMap = {};
            for(const psRecord of psData.records) {
                const ps = {};
                ps.Id = psRecord.Id;
                ps.Name = psRecord.Profile ? psRecord.Profile.Name + '(P)' : (psRecord.NamespacePrefix ? psRecord.NamespacePrefix + '__' + psRecord.Name : psRecord.Name) + '(PS)';

                psMap[ps.Id] = ps;
            }

            const mpsMap = {};
            for(const mpsRecord of mpsData.records) {
                const mps = {};
                mps.Id = mpsRecord.Id;

                mpsMap[mps.Id] = mps;
            }

            const psgMap = {};
            for(const psgRecord of psgData.records) {
                const psg = {};
                psg.Id = psgRecord.Id;
                psg.Name = (psgRecord.NamespacePrefix ? psgRecord.NamespacePrefix + '__' + psgRecord.DeveloperName : psgRecord.DeveloperName) + '(PSG)';

                psgMap[psg.Id] = psg;
            }

            const psgcMap = {};
            const mpsgcMap = {};
            for(const psgcRecord of psgcData.records) {
                if(mpsMap[psgcRecord.PermissionSetId]) {
                    const list = mpsgcMap[psgcRecord.PermissionSetGroupId] || [];
                    list.push(psgcRecord.PermissionSetId);
                    mpsgcMap[psgcRecord.PermissionSetGroupId] = list;
                }
                else {
                    const list = psgcMap[psgcRecord.PermissionSetGroupId] || [];
                    list.push(psgcRecord.PermissionSetId);
                    psgcMap[psgcRecord.PermissionSetGroupId] = list;
                }
            }

            for(const op of opData.records) {
                const ps = psMap[op.ParentId];
                if(ps) {
                    for(const permissionName of permissionNames) {
                        ps[permissionName] = op[permissionName];
                    }
                }

                const mps = mpsMap[op.ParentId];
                if(mps) {
                    for(const permissionName of permissionNames) {
                        mps[permissionName] = op[permissionName];
                    }
                }
            }

            for(const psg of Object.values(psgMap)) {
                const list = psgcMap[psg.Id] || [];
                const mlist = mpsgcMap[psg.Id] || [];
                for(const permissionName of permissionNames) {
                    for(const psId of list) {
                        const ps = psMap[psId];
                        if(ps[permissionName]) {
                            psg[permissionName] = true;
                        }
                    }

                    for(const mpsId of mlist) {
                        const mps = mpsMap[mpsId];
                        if(mps[permissionName]) {
                            psg[permissionName] = false;
                        }
                    }
                }
            }

            const userPerms = {};
            for(const psaRecord of psaData.records) {
                if(psaRecord.PermissionSetGroupId) {
                    const psg = psgMap[psaRecord.PermissionSetGroupId];
                    for(const permissionName of permissionNames) {
                        if(psg[permissionName]) {
                            const list = userPerms[permissionName] || [];
                            list.push(psg.Name);
                            userPerms[permissionName] = list;
                        }
                    }
                }
                else if(psaRecord.PermissionSetId) {
                    const ps = psMap[psaRecord.PermissionSetId];
                    for(const permissionName of permissionNames) {
                        if(ps[permissionName]) {
                            const list = userPerms[permissionName] || [];
                            list.push(ps.Name);
                            userPerms[permissionName] = list;
                        }
                    }
                }
            }

            for(const permissionName of permissionNames) {
                const userPerm = userPerms[permissionName] || [];
                result.push({
                    name: permissionName,
                    label: permissionName.substring(11),
                    source: userPerm.length === 0 ? '-' : userPerm.join(', '),
                });
            }

            const columns = {
                name: {},
                label: {},
                source: {},
            };

            context.ux.table(result, columns);
            return result;
        });
    });
})
