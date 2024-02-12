(function(cmd, context) {
    const userId = context.argv[0];
    if(!userId) {
        cmd.error('User Id is required');
        return;
    }

    const setupEntityType = context.argv[1];
    let setupEntityTypePromise = null;
    if(setupEntityType) {
        setupEntityTypePromise = Promise.resolve(setupEntityType);
    }
    else {
        setupEntityTypePromise = context.connection.sobject('SetupEntityAccess').describe().then(data => {
            const setupEntityTypeField = data.fields.find(f => f.name === 'SetupEntityType');
            return context.inquirer.prompt([{
                name: 'setupEntityType',
                message: 'Select Setup Entity Type',
                type: 'list',
                choices: setupEntityTypeField.picklistValues.map(pv => ({ name: pv.value })),
            }]).then(resp => {
                return resp.setupEntityType;
            });
        });
    }

    return setupEntityTypePromise.then(setupEntityType => {
        return Promise.all([
            context.connection.query(`SELECT Id, Name, NamespacePrefix, Profile.Name FROM PermissionSet`),
            context.connection.query(`SELECT Id FROM MutingPermissionSet`),
            context.connection.query(`SELECT Id, DeveloperName, NamespacePrefix FROM PermissionSetGroup`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetGroupComponent`),
            context.connection.query(`SELECT PermissionSetId, PermissionSetGroupId FROM PermissionSetAssignment WHERE IsActive = true AND AssigneeId = '${userId}'`),
            context.connection.query(`SELECT ParentId, SetupEntityId FROM SetupEntityAccess WHERE SetupEntityType = '${setupEntityType}'`),
        ]).then(([ psData, mpsData, psgData, psgcData, psaData, seaData ]) => {
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

            const seaMap = {};
            const setupEntityIdsSet = new Set();
            for(const sea of seaData.records) {
                const list = seaMap[sea.ParentId] || [];
                list.push(sea.SetupEntityId);
                setupEntityIdsSet.add(sea.SetupEntityId);

                seaMap[sea.ParentId] = list;
            }
            const setupEntityIds = [ ...setupEntityIdsSet ];

            for(const ps of Object.values(psMap)) {
                const setupEntityIds = seaMap[ps.Id] || [];
                for(const setupEntityId of setupEntityIds) {
                    ps[setupEntityId] = true;
                }
            }

            for(const psg of Object.values(psgMap)) {
                const list = psgcMap[psg.Id] || [];
                const mlist = mpsgcMap[psg.Id] || [];
                for(const psId of list) {
                    const setupEntityIds = seaMap[psId] || [];
                    for(const setupEntityId of setupEntityIds) {
                        psg[setupEntityId] = true;
                    }
                }

                for(const mpsId of mlist) {
                    const setupEntityIds = seaMap[mpsId] || [];
                    for(const setupEntityId of setupEntityIds) {
                        psg[setupEntityId] = false;
                    }
                }
            }

            const userPerms = {};
            for(const psaRecord of psaData.records) {
                if(psaRecord.PermissionSetGroupId) {
                    const psg = psgMap[psaRecord.PermissionSetGroupId];
                    for(const setupEntityId of setupEntityIds) {
                        if(psg[setupEntityId]) {
                            const list = userPerms[setupEntityId] || [];
                            list.push(psg.Name);
                            userPerms[setupEntityId] = list;
                        }
                    }
                }
                else if(psaRecord.PermissionSetId) {
                    const ps = psMap[psaRecord.PermissionSetId];
                    for(const setupEntityId of setupEntityIds) {
                        if(ps[setupEntityId]) {
                            const list = userPerms[setupEntityId] || [];
                            list.push(ps.Name);
                            userPerms[setupEntityId] = list;
                        }
                    }
                }
            }

            const ids = setupEntityIds.map(i => "'" + i + "'").join(',');
            let nameMapPromise = null;
            if(ids) {
                if(setupEntityType === 'ApexClass') {
                    nameMapPromise = context.connection.query(`SELECT Id, Name, NamespacePrefix FROM ApexClass WHERE Id IN (${ids})`)
                        .then(data => {
                            return data.records.reduce((res, cur) => {
                                const name = cur.NamespacePrefix ? cur.NamespacePrefix + '__' + cur.Name : cur.Name;
                                res[cur.Id] = {
                                    id: cur.Id,
                                    name,
                                    label: name,
                                };

                                return res;
                            }, {});
                        });
                }
                else if(setupEntityType === 'ApexPage') {
                    nameMapPromise = context.connection.query(`SELECT Id, Name, NamespacePrefix, MasterLabel FROM ApexPage WHERE Id IN (${ids})`)
                        .then(data => {
                            return data.records.reduce((res, cur) => {
                                const name = cur.NamespacePrefix ? cur.NamespacePrefix + '__' + cur.Name : cur.Name;
                                res[cur.Id] = {
                                    id: cur.Id,
                                    name,
                                    label: cur.MasterLabel,
                                };

                                return res;
                            }, {});
                        });
                }
                else if(setupEntityType === 'CustomPermission') {
                    nameMapPromise = context.connection.query(`SELECT Id, DeveloperName, NamespacePrefix, MasterLabel FROM CustomPermission WHERE Id IN (${ids})`)
                        .then(data => {
                            return data.records.reduce((res, cur) => {
                                const name = cur.NamespacePrefix ? cur.NamespacePrefix + '__' + cur.DeveloperName : cur.DeveloperName;
                                res[cur.Id] = {
                                    id: cur.Id,
                                    name,
                                    label: cur.MasterLabel,
                                };

                                return res;
                            }, {});
                        });
                }
                else {
                    nameMapPromise = Promise.resolve({});
                }
            }
            else {
                nameMapPromise = Promise.resolve({});
            }

            return nameMapPromise.then(nameMap => {
                for(const setupEntityId of setupEntityIds) {
                    const userPerm = userPerms[setupEntityId] || [];
                    const name = nameMap[setupEntityId] || {
                        id: setupEntityId,
                        name: setupEntityId,
                        label: setupEntityId,
                    };

                    result.push({
                        id: name.id,
                        name: name.name,
                        label: name.label,
                        source: userPerm.length === 0 ? '-' : userPerm.join(', '),
                    });
                }

                const columns = {
                    id: {},
                    name: {},
                    label: {},
                    source: {},
                };

                context.ux.table(result, columns);
                return result;
            });
        });
    });
})
