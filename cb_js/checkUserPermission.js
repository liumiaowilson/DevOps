(function(cmd, context) {
    const userId = context.argv[0];
    if(!userId) {
        cmd.error('User Id is required');
        return;
    }

    return Promise.all([
        context.connection.sobject('User').describe(),
        context.connection.sobject('PermissionSet').describe(),
    ]).then(([ userDescribe, permissionSetDescribe ]) => {
        const userPermissionNames = userDescribe.fields
            .filter(f => f.name.startsWith('UserPermission'))
            .map(f => ({ name: f.name, label: f.label }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const psPermissionNames = permissionSetDescribe.fields
            .filter(f => f.name.startsWith('Permission') && f.name !== 'PermissionSetGroupId')
            .map(f => ({ name: f.name, label: f.label }))
            .sort((a, b) => a.name.localeCompare(b.name));

        return Promise.all([
            context.connection.query(`SELECT Id, ${userPermissionNames.map(n => n.name).join(', ')} FROM User WHERE Id = '${userId}'`),
            context.connection.query(`SELECT Id, Name, NamespacePrefix, Profile.Name, ${psPermissionNames.map(n => n.name).join(', ')} FROM PermissionSet`),
            context.connection.query(`SELECT Id, ${psPermissionNames.map(n => n.name).join(', ')} FROM MutingPermissionSet`),
            context.connection.query(`SELECT Id, DeveloperName, NamespacePrefix FROM PermissionSetGroup`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetGroupComponent`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetAssignment WHERE IsActive = true AND AssigneeId = '${userId}'`),
        ]).then(([ userData, psData, mpsData, psgData, psgcData, psaData ]) => {
            const result = [];
            const user = userData.records[0];
            if(!user) {
                cmd.error('No such user found');
                return;
            }

            for(const userPermissionName of userPermissionNames) {
                result.push({
                    name: userPermissionName.name,
                    label: userPermissionName.label,
                    source: user[userPermissionName.name] ? 'User' : '-',
                });
            }

            const psMap = {};
            for(const psRecord of psData.records) {
                const ps = {};
                ps.Id = psRecord.Id;
                ps.Name = psRecord.Profile ? psRecord.Profile.Name + '(P)' : (psRecord.NamespacePrefix ? psRecord.NamespacePrefix + '__' + psRecord.Name : psRecord.Name) + '(PS)';
                for(const psPermissionName of psPermissionNames) {
                    ps[psPermissionName.name] = psRecord[psPermissionName.name];
                }

                psMap[ps.Id] = ps;
            }

            const mpsMap = {};
            for(const mpsRecord of mpsData.records) {
                const mps = {};
                mps.Id = mpsRecord.Id;
                for(const psPermissionName of psPermissionNames) {
                    mps[psPermissionName.name] = mpsRecord[psPermissionName.name];
                }

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
                }
                else {
                    const list = psgcMap[psgcRecord.PermissionSetGroupId] || [];
                    list.push(psgcRecord.PermissionSetId);
                }
            }

            for(const psg of Object.values(psgMap)) {
                const list = psgcMap[psg.Id] || [];
                const mlist = mpsgcMap[psg.Id] || [];
                for(const psPermissionName of psPermissionNames) {
                    for(const psId of list) {
                        const ps = psMap[psId];
                        if(ps[psPermissionName.name]) {
                            psg[psPermissionName.name] = true;
                        }
                    }

                    for(const mpsId of mlist) {
                        const mps = mpsMap[mpsId];
                        if(mps[psPermissionName.name]) {
                            psg[psPermissionName.name] = false;
                        }
                    }
                }
            }

            const userPerms = {};
            for(const psaRecord of psaData.records) {
                if(psaRecord.PermissionSetId) {
                    const ps = psMap[psaRecord.PermissionSetId];
                    for(const psPermissionName of psPermissionNames) {
                        if(ps[psPermissionName.name]) {
                            const list = userPerms[psPermissionName.name] || [];
                            list.push(ps.Name);
                            userPerms[psPermissionName.name] = list;
                        }
                    }
                }

                if(psaRecord.PermissionSetGroupId) {
                    const psg = psgMap[psaRecord.PermissionSetGroupId];
                    for(const psPermissionName of psPermissionNames) {
                        if(psg[psPermissionName.name]) {
                            const list = userPerms[psPermissionName.name] || [];
                            list.push(psg.Name);
                            userPerms[psPermissionName.name] = list;
                        }
                    }
                }
            }

            for(const psPermissionName of psPermissionNames) {
                const userPerm = userPerms[psPermissionName.name] || [];
                result.push({
                    name: psPermissionName.name,
                    label: psPermissionName.label,
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
