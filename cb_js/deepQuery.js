const clone = obj => JSON.parse(JSON.stringify(obj));

const globalDescribes = {};

const getDescribe = (objectApiName, connection) => {
    if(globalDescribes[objectApiName]) {
        return Promise.resolve(globalDescribes[objectApiName]);
    }
    else {
        return connection.describe(objectApiName).then(objDescribe => {
            globalDescribes[objectApiName] = objDescribe;
            return objDescribe;
        }).catch(err => null);
    }
};

const queryAll = async (connection, query, cmd) => {
    const result = await connection.query(query);

    while(!result.done) {
        const more = await connection.queryMore(result.nextRecordsUrl);
        result.records.push(...more.records);
        result.totalSize += more.totalSize;
        result.done = more.done;
        result.nextRecordsUrl = more.nextRecordsUrl;
    }

    return result;
};

class Node {
    constructor(connection, soqlParser, cmd) {
        this.connection = connection;
        this.soqlParser = soqlParser;
        this.cmd = cmd;

        this.ast = null;
        this.parentFieldName = null;
        this.children = {};
        this.data = null;
    }

    init(ast, parentFieldName) {
        this.ast = clone(ast);
        this.ast.fields = this.ast.fields.filter(field => field.type !== 'FieldSubquery');

        const objectApiName = this.ast.sObject;

        return getDescribe(objectApiName, this.connection).then(objDescribe => {
            const fieldsAllField = this.ast.fields.find(field => field.type === 'FieldFunctionExpression'
                && field.functionName === 'FIELDS'
                && field.parameters[0] === 'All'
                && !field.alias
            )

            const fieldsParentFields = this.ast.fields.filter(field => field.type === 'FieldFunctionExpression'
                && field.functionName === 'FIELDS'
                && field.parameters[0] === 'All'
                && field.alias
            );

            if(fieldsAllField) {
                this.ast.fields = globalDescribes[this.ast.sObject].fields.map(field => {
                    return {
                        type: 'Field',
                        field: field.name,
                    };
                });
            }

            this.parentFieldName = parentFieldName;

            if(this.parentFieldName && !this.ast.fields.find(field => field.field === this.parentFieldName)) {
                this.ast.fields.push({
                    type: 'Field',
                    field: this.parentFieldName,
                });
            }

            return Promise.all(fieldsParentFields.map(fieldsParentField => {
                const parentField = fieldsParentField.alias;
                const parentFieldName = parentField.endsWith('__r') ? parentField.substring(0, parentField.length - 1) + 'c' : parentField + 'Id';
                const field = globalDescribes[this.ast.sObject].fields.find(field => field.name === parentFieldName);
                return getDescribe(field.referenceTo[0], this.connection).then(objDescribe => {
                    if(!objDescribe) return;

                    objDescribe.fields.forEach(field => {
                        this.ast.fields.push({
                            "type": "FieldRelationship",
                            "field": field.name,
                            "relationships": [
                                parentField,
                            ],
                        });
                    });
                });
            })).then(dataList => {
                const subQueries = ast.fields.filter(field => field.type === 'FieldSubquery');

                const childRelationshipMap = {};
                for(const childRelationship of objDescribe.childRelationships) {
                    if(!childRelationship.relationshipName) continue;

                    childRelationshipMap[childRelationship.relationshipName] = childRelationship;
                }

                const query = this.soqlParser.composeQuery(this.ast);
                return queryAll(this.connection, query, this.cmd).then(data => {
                    this.data = data;

                    if(!this.data.records.length) return;

                    return Promise.all(subQueries.map(subQuery => {
                        const subAst = clone(subQuery.subquery);
                        const relationshipName = subAst.relationshipName;
                        delete subAst.relationshipName;
                        const childRelationship = childRelationshipMap[relationshipName];
                        if(!childRelationship) {
                            throw new Error('Invalid child relationship name: ' + relationshipName + ' for ' + objectApiName);
                        }

                        const parentFieldName = childRelationship.field;
                        subAst.sObject = childRelationship.childSObject;

                        const idClause = {
                            field: parentFieldName,
                            operator: "IN",
                            literalType: "STRING",
                            value: this.data.records.map(record => "'" + record.Id + "'"),
                        };

                        if(!subAst.where) {
                            subAst.where = {
                                left: idClause,
                            };
                        }
                        else {
                            subAst.where = {
                                left: idClause,
                                operator: 'AND',
                                right: subAst.where,
                            };
                        }

                        const child = new Node(this.connection, this.soqlParser, this.cmd);
                        this.children[relationshipName] = child;
                        return child.init(subAst, parentFieldName);
                    }));
                });
            });
        });
    }

    reconcile() {
        Object.keys(this.children).forEach(key => {
            const child = this.children[key];
            for(const record of this.data.records) {
                const childRecords = [];
                for(const childRecord of child.data.records) {
                    if(childRecord[child.parentFieldName] === record.Id) {
                        childRecords.push(childRecord);
                    }
                }

                record[key] = {
                    totalSize: childRecords.length,
                    done: true,
                    records: childRecords,
                };
            }

            child.reconcile();
        });
    }
}

(function(cmd, context) {
    const path = context.argv[0];
    if(!path) {
        cmd.error('Path is required');
        return;
    }

    context.ux.action.start('Querying');
    return context.fs.readFile(path, 'utf8').then(lines => {
        return context.require('soql-parser-js').then(({ default: soqlParser }) => {
            return Promise.all(lines.split('\n').filter(Boolean).map(query => {
                const ast = soqlParser.parseQuery(query);
                const root = new Node(context.connection, soqlParser, cmd);
                return getDescribe(ast.sObject, context.connection).then(() => {
                    return root.init(ast, null).then(() => {
                        root.reconcile();

                        return root.data;
                    });
                });
            })).then(dataList => {
                const records = dataList.flatMap(data => data.records);
                const result = {
                    totalSize: records.length,
                    done: true,
                    records,
                };

                cmd.log(JSON.stringify(result, (key, value) => value !== null ? value : undefined, 4));

                return result;
            });
        });
    }).finally(() => context.ux.action.stop());
})
