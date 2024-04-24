function findRealKey(prefixMap, key) {
    if(!key.startsWith('<ns>__')) {
        return key;
    }

    const name = key.substring(6);
    const objectApiName = Object.values(prefixMap).find(val => val.endsWith('__' + name));
    return objectApiName;
}

function getRecordDef(recordTreeMap, objectApiName) {
    if(recordTreeMap[objectApiName]) {
        return recordTreeMap[objectApiName];
    }
    else {
        const items = objectApiName.split('__');
        if(items.length < 3) {
            return;
        }

        const ns = items[0];
        const name = items[1] + '__' + items[2];
        const newObjectApiName = '<ns>__' + name;
        if(!recordTreeMap[newObjectApiName]) {
            return;
        }

        const def = recordTreeMap[newObjectApiName];
        return hydrateWithNamespace(def, ns);
    }
}

function hydrateWithNamespace(data, ns) {
    const str = JSON.stringify(data);
    return JSON.parse(str.replace(/<ns>/g, ns));
}

class Node {
    constructor(
        objectApiName,
        parentRelationshipName,
        isRoot,
        filter,
        childRelationshipsMap,
        recordTreeMap,
        cmd,
        depth = 0
    ) {
        this.objectApiName = objectApiName;
        this.parentRelationshipName = parentRelationshipName;
        this.isRoot = isRoot;
        this.filter = filter;
        this.childRelationshipsMap = childRelationshipsMap;
        this.recordTreeMap = recordTreeMap;
        this.cmd = cmd;
        this.depth = depth;
    }

    build() {
        const parentName = this.isRoot ? this.objectApiName : this.parentRelationshipName;
        const fields = [ 'Fields(All)' ];
        const recordTreeDef = getRecordDef(this.recordTreeMap, this.objectApiName);
        if(recordTreeDef) {
            if(recordTreeDef.parentFields && recordTreeDef.parentFields.length) {
                for(const parentField of recordTreeDef.parentFields) {
                    fields.push('Fields(All) ' + parentField);
                }
            }

            const childRelationshipsDef = this.childRelationshipsMap[this.objectApiName];

            if(recordTreeDef.childRelationships && recordTreeDef.childRelationships.length) {
                for(const childRelationshipName of recordTreeDef.childRelationships) {
                    const childObjectApiName = childRelationshipsDef[childRelationshipName];
                    if(!childObjectApiName) {
                        this.cmd.error('Referenced child relationship ' + childRelationshipName + ' has undefined object ' + childObjectApiName);
                        return;
                    }

                    const childNode = new Node(
                        childObjectApiName,
                        childRelationshipName,
                        false,
                        null,
                        this.childRelationshipsMap,
                        this.recordTreeMap,
                        this.cmd,
                        childRelationshipName === this.parentRelationshipName ? this.depth + 1 : 0
                    );

                    if(childNode.depth > 3) {
                        continue;
                    }

                    fields.push('(' + childNode.build() + ')');
                }
            }
        }

        let query = 'SELECT ';
        query += fields.join(', ');
        query += ' FROM ' + parentName;
        if(this.filter) {
            query += ' WHERE ' + this.filter;
        }

        if(recordTreeDef?.orderByFieldName) {
            query += ' ORDER BY ' + recordTreeDef.orderByFieldName + ' ' + (recordTreeDef.orderByFieldDirection || 'ASC');
        }

        return query;
    }
}

(function(cmd, context) {
    const recordId = context.argv[0];
    if(!recordId) {
        cmd.error('Record Id is required');
        return;
    }

    const homeDir = context.env.getString('CODE_BUILDER_HOME');
    context.ux.action.start('Generate Record Query');
    return Promise.all([
        context.fs.readFile(homeDir + '/keyPrefix.json', 'utf8'),
        context.fs.readFile(homeDir + '/DevOps/json/recordTree.json', 'utf8'),
    ]).then(([ keyPrefixJSON, recordTreeJSON ]) => {
        const prefixMap = JSON.parse(keyPrefixJSON);
        const recordTreeMap = JSON.parse(recordTreeJSON);
        return Promise.all(Object.keys(recordTreeMap).map(key => {
            key = findRealKey(prefixMap, key);
            return context.connection.describe(key).then(objDescribe => {
                const childRelationships = {};
                for(const childRelationship of objDescribe.childRelationships) {
                    if(childRelationship.relationshipName) {
                        childRelationships[childRelationship.relationshipName] = childRelationship.childSObject;
                    }
                }

                return {
                    [key]: childRelationships,
                };
            }).catch(err => ({}));
        })).then(childRelationshipsList => {
            const childRelationshipsMap = childRelationshipsList.reduce((res, cur) => {
                return {
                    ...res,
                    ...cur,
                };
            }, {});

            const objectApiName = prefixMap[recordId.substring(0, 3)];

            const root = new Node(
                objectApiName,
                null,
                true,
                `Id = '${recordId}'`,
                childRelationshipsMap,
                recordTreeMap,
                cmd
            );

            const query = root.build();
            cmd.log(query);
            return query;
        });
    }).finally(() => context.ux.action.stop());
})
