class Node {
    constructor(
        objectApiName,
        parentRelationshipName,
        isRoot,
        filter,
        childRelationshipsMap,
        recordTreeMap,
        cmd
    ) {
        this.objectApiName = objectApiName;
        this.parentRelationshipName = parentRelationshipName;
        this.isRoot = isRoot;
        this.filter = filter;
        this.childRelationshipsMap = childRelationshipsMap;
        this.recordTreeMap = recordTreeMap;
        this.cmd = cmd;
    }

    build() {
        const parentName = this.isRoot ? this.objectApiName : this.parentRelationshipName;
        const fields = [ 'Fields(All)' ];
        const recordTreeDef = this.recordTreeMap[this.objectApiName];
        if(recordTreeDef) {
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
                        this.cmd
                    );

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
        const recordTreeMap = JSON.parse(recordTreeJSON);
        return Promise.all(Object.keys(recordTreeMap).map(key => {
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
            });
        })).then(childRelationshipsList => {
            const childRelationshipsMap = childRelationshipsList.reduce((res, cur) => {
                return {
                    ...res,
                    ...cur,
                };
            }, {});

            const prefixMap = JSON.parse(keyPrefixJSON);

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
